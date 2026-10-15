# HBK1002 — Runtime, JSX, and document lifecycle

The MarkScript runtime converts JSX construction values to validated MDAST.
It gives `onTransform` and `onReady` for lifetime registration. Its scope is document construction, validation, and lifecycle management.
TypeScript libraries give format conversion, publication, network operations, database access, and application policy.

`packages/markscript/src/index.ts` implements the public package, `@markscript/markscript`.
`packages/runtime/src/index.ts` defines low-level runtime exports.
For most documents, use only `onTransform`, `onReady`, and types from `@markscript/markscript`.
The compiler inserts JSX runtime imports.

## Public imports

```ts
import {
  attach,
  group,
  onReady,
  onTransform,
  stripData,
  type MarkScriptEntry,
  type MarkValue,
  type ReadyContext,
  type TransformContext
} from '@markscript/markscript'
```

Tooling and framework authors can import lower-level facilities directly:

```ts
import {
  deepFreeze,
  executeDocument,
  lowerToRoot,
  validateRoot,
  validateNodeForContext
} from '@markscript/runtime'
```

The JSX transform targets `@markscript/runtime/jsx-runtime` in production and
`@markscript/runtime/jsx-dev-runtime` in development. Those subpaths export
`Fragment`, `jsx`, `jsxs`, and `jsxDEV` with the intrinsic type declarations.

## The internal construction values

Before MDAST conversion, JSX and expressions form a small value graph:

```ts
type MarkValue =
  | MarkElement
  | MarkFragment
  | MarkAnnotation
  | MarkGroup
  | MdastNode
  | readonly MarkValue[]
  | string
  | number
  | boolean
  | null
  | undefined
```

`MarkElement`, `MarkFragment`, `MarkAnnotation`, and `MarkGroup` are branded construction values.
Parsed directives create annotations or temporary groups.
`lowerToRoot` attaches their data and flattens each group before it returns the final MDAST root.

The runtime rejects any values, including objects with custom `toString` methods.
Convert them explicitly to text, return supported JSX, or construct a valid MDAST node.

## JSX call behavior

The JSX runtime follows three branches:

1. `Fragment` rejects props other than children, then creates a fragment value.
2. A function is called immediately as an uppercase component.
3. A recognized lowercase string creates a Markdown element value.

Other names and values cause errors. JSX keys also cause errors because MarkScript and MDAST define no key identity.
TypeScript finds many invalid props and names. The runtime validates dynamic values and transpile-only execution.

Consumer source stays a standard `code` node with a language label.
Transforms select it through standard MDAST fields:

```ts
import {onTransform} from '@markscript/markscript'
import {visit} from 'unist-util-visit'

onTransform(({root}) => {
  visit(root, 'code', node => {
    if (node.lang !== 'diagram') return
    const options = node.data?.diagram
    // Interpret node.value and replace the node with ordinary MDAST.
  })
})
```

Temporary construction values keep source locations from `jsxDEV`.
Runtime diagnostics can thus identify the original file, line, and column.
Refer to `packages/runtime/src/jsx-runtime.ts` for the implementation.

Expression-valued metadata uses the public helpers:

```ts
attach(namespace, data)
group(namespace, data, children)
```

The compiler uses these functions for directive syntax.
Use `attach` for metadata with arrays, nested objects, numbers, or computed values.

## Authoring components

Components are TypeScript functions. Give props specific types.
For children that MarkScript converts to MDAST, use `unknown`. A component can be synchronous or asynchronous.

```mdx
export interface CalloutProps {
  kind: 'note' | 'warning'
  children?: unknown
}

export function Callout({kind, children}: CalloutProps) {
  return (
    <blockquote>
      {attach('style', {role: kind})}
      <strong>{kind === 'note' ? 'Note: ' : 'Warning: '}</strong>
      {children}
    </blockquote>
  )
}
```

An attachment inside a component uses the same next-node rule as a document attachment.
Here, `style` attaches to `strong`, the next compatible node in the component's blockquote child sequence.
To annotate the blockquote, put the annotation immediately before the component invocation in the parent sequence.

MarkScript records component invocations lazily. During rendering, it resolves children before their parent and siblings from left to right.
An async component completes before the next sibling starts. Lifecycle callbacks thus keep source registration order.

```mdx
export async function Records() {
  const records = await loadRecords()
  return records.map(record => (
    <Callout kind="note">{record.title}</Callout>
  ))
}

<Records />
```

The runtime waits for the direct component result. Promises inside the resolved value stay invalid.
Use `Promise.all` to combine them into the direct result.

## Intrinsic lowering details

The lowerer enforces both output shape and parent context.

| Intrinsic group | Required context | Child context |
|---|---|---|
| Headings and paragraph | root or block | phrasing |
| Emphasis and strong | phrasing or link | phrasing |
| Link | phrasing outside links | link phrasing |
| Image, break, inline code | phrasing or link | none or restricted text |
| Blockquote | root or block | blocks and definitions |
| Ordered/unordered list | root or block | list items |
| List item | list | blocks and definitions |
| Thematic break and block code | root or block | none |
| Block directive | root or block | blocks and definitions |
| Leaf directive | root or block | phrasing |
| Inline directive | phrasing or link | phrasing |

The lowerer puts phrasing intrinsics returned at root or block level in a paragraph.
A component can thus return `<strong>` as a top-level value. The resulting tree satisfies paragraph child validation.

The runtime validates existing MDAST roots returned as document values.
At root or block level, it inserts their children into the surrounding sequence.
Existing non-root nodes keep object identity during the mutable phase. Each node object can appear at one location.

## Document lifecycle

`executeDocument` uses `AsyncLocalStorage` to create isolated state for each entry invocation.
Concurrent document executions use separate callback queues.

```text
render
  -> lower baseline MarkValue to mdast.Root
  -> transform callbacks, sequential and awaited
  -> final structural validation
  -> deep freeze
  -> ready callbacks, sequential and awaited
  -> resolve mdast.Root
  -> close and clear callback state
```

| Phase | Root state | Permitted work |
|---|---|---|
| Module initialization | No document root | Standard ESM initialization |
| Render | Construction value evaluation | Register `onTransform` and `onReady`. Evaluate expressions |
| Transform | Full mutable baseline root | Change, insert, remove, or annotate MDAST |
| Validation/freeze | Internal transition | Enforce final structure and node uniqueness |
| Ready | Full deeply read-only root | Examine, serialize, publish, or do I/O |
| Closed | Completed invocation | No callback registration |

Registration is valid only during render.
A call to `onTransform` or `onReady` outside an active document causes `ERR1301`.
Registration from a transform or ready callback also causes this error.

## Transform callbacks

`onTransform(callback)` queues mutable work for the full baseline tree.

```ts
interface TransformContext {
  root: mdast.Root
}
```

Callbacks execute in registration order. The runtime waits for one callback at a time.
Each callback sees changes from earlier callbacks.

```mdx
import {onTransform} from '@markscript/markscript'
import {visit} from 'unist-util-visit'

{
  onTransform(({root}) => {
    visit(root, 'heading', node => {
      node.data ??= {}
      node.data.style = {
        ...(node.data.style as object | undefined),
        keepWithNext: true
      }
    })
  })
}
```

The callback can use any MDAST or unist utility.
Final validation rejects invalid nodes, reused node objects, nodes in incorrect contexts, and invalid fields.
This validation occurs after all transforms execute.

Transform callbacks can be asynchronous.
The runtime waits for each returned promise to settle before the next callback starts.

## Ready callbacks

`onReady(callback)` queues ready-lifetime work.

```ts
interface ReadyContext {
  readonly root: DeepReadonly<mdast.Root>
}
```

The runtime validates and deeply freezes the root before the first ready callback.
It waits for ready callbacks sequentially in registration order.
Callbacks can serialize, write files, publish, do network operations, or call any library.
The frozen root prevents document changes in this phase.

```mdx
import {onReady} from '@markscript/markscript'
import {writeFile} from 'node:fs/promises'

{
  onReady(async ({root}) => {
    await writeFile('document.json', JSON.stringify(root, null, 2))
  })
}
```

The entry resolves after every asynchronous ready callback completes.
A callback exception rejects the entry with standard JavaScript error semantics.
Under `markscript run`, CLI format conversion and stdout output occur after full lifecycle resolution.

## Final data and deep freezing

The final graph can contain scalars, arrays, and plain objects with `Object.prototype` or `null` as their prototype.
`ERR1201` rejects accessor properties, functions, class instances, maps, sets, dates, response objects, and other values outside the deeply read-only data model.

Convert library objects to plain records during a transform callback:

```ts
node.data = {
  ...node.data,
  source: {
    id: record.id,
    label: record.label,
    fetchedAt: record.fetchedAt.toISOString()
  }
}
```

Directive attachments from `attach` can initially contain live evaluated values for a transform to use.
Before final validation and freezing, replace functions, class instances, and other non-document values with plain readable data.
Alternatively, remove that metadata.

Validation also enforces node uniqueness. Each node object can occur only once.
Metadata object identity uses standard data structure semantics.
For portability, keep metadata free of cycles. JSON and Markdown adapters can fail to serialize cycles.
CLI format failures use `ERR2101`.

## Removing metadata

`stripData(tree)` returns a detached copy without MDAST `data` fields. It keeps the input unchanged.
The helper thus works with frozen final roots.

```ts
import {stripData} from '@markscript/markscript'

const portable = stripData(root)
```

The helper copies arrays, positions, node fields, and plain nested records.
A visited-object map stops recursion through shared non-node metadata.
Refer to `packages/runtime/src/data.ts` for the implementation.

## Runtime diagnostics

| Failure | Typical code or behavior |
|---|---|
| Unknown intrinsic | `ERR1101` |
| Invalid prop, key, or void children | `ERR1102` |
| Unsupported value, `true`, or promise content | `ERR1103` |
| Flow/phrasing/list mismatch or nested link | `ERR1104` |
| Invalid or stranded annotation | `ERR1105` |
| Invalid MDAST field or non-freezable final data | `ERR1201` |
| Reused or cyclic MDAST node | `ERR1202` |
| Invalid lifetime registration | `ERR1301` |
| Exception thrown by user/library callback | Propagated unchanged |

Use `markscript help CODE` to read the indexed manual entry for a MarkScript diagnostic code.

## Implementation references

| Concern | Source |
|---|---|
| MarkValue and callback types | `packages/runtime/src/types.ts` |
| JSX calls and component dispatch | `packages/runtime/src/jsx-runtime.ts` |
| Intrinsic props | `packages/runtime/src/intrinsics.ts` |
| Value normalization and intrinsic lowering | `packages/runtime/src/lower.ts` |
| Directive attachment queues and `data` merge | `packages/runtime/src/annotations.ts` |
| Lifetime state and callback order | `packages/runtime/src/lifecycle.ts` |
| Final MDAST validation | `packages/runtime/src/validate.ts` |
| Deep node-uniqueness and freeze checks | `packages/runtime/src/freeze.ts` |
| Detached metadata stripping | `packages/runtime/src/data.ts` |
| Directive constructors | `packages/runtime/src/directives.ts` |
| Stable runtime error shape | `packages/runtime/src/errors.ts` |
