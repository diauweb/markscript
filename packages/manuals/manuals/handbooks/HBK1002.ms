# HBK1002 — Runtime, JSX, and document lifecycle

The MarkScript runtime turns JSX construction values into validated MDAST and
provides the two lifetime registration APIs, `onTransform` and `onReady`. Its scope
is document construction, validation, and lifecycle management. TypeScript
libraries provide format conversion, publishing, networking, database access,
and application policy.

The public package is `@markscript/markscript`, implemented by
`packages/markscript/src/index.ts`. Low-level runtime exports are defined in
`packages/runtime/src/index.ts`. Most documents need only `onTransform`, `onReady`,
and types from `@markscript/markscript`; the compiler injects the JSX runtime
imports.

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

Before lowering, JSX and expressions form a lightweight value graph:

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

`MarkElement`, `MarkFragment`, `MarkAnnotation`, and `MarkGroup` are branded
construction values. Parsed directives create annotations or temporary groups.
`lowerToRoot` attaches their data and flattens every group before returning the
final MDAST root.

The runtime rejects arbitrary values, including objects with custom `toString`
methods. Convert them explicitly to text, return a supported JSX value, or
construct a valid MDAST node.

## JSX call behavior

The JSX runtime follows three branches:

1. `Fragment` creates a fragment value after rejecting non-children props.
2. A function is called immediately as an uppercase component.
3. A recognized lowercase string creates a Markdown element value.

Other names and values fail. JSX keys also fail because MarkScript and MDAST
define no key identity. TypeScript catches many invalid props and names. The
runtime validates dynamic and transpile-only execution.

Consumer source remains an ordinary language-labelled `code` node. Transforms
select it without a special runtime type:

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

Source locations supplied by `jsxDEV` are retained on temporary construction
values so runtime diagnostics can name the original file, line, and column.
The implementation is in `packages/runtime/src/jsx-runtime.ts`.

Expression-valued metadata uses the public helpers:

```ts
attach(namespace, data)
group(namespace, data, children)
```

The compiler uses these functions for directive syntax. `attach` is also useful
when metadata contains arrays, nested objects, numbers, or computed values.

## Authoring components

Components are TypeScript functions. Give their props specific types and
represent children as `unknown` when MarkScript will lower them. A component
may be synchronous or asynchronous.

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

An attachment inside a component follows the same next-node rule as one in the
document. In this example, `style` attaches to the `strong` node because it
is the next compatible node in that component's blockquote child sequence. If
the intent is to annotate the blockquote, place the annotation immediately
before the component invocation in the parent sequence.

MarkScript records JSX component invocations lazily. During rendering, it
resolves child components before their parent and resolves sibling components
left-to-right. An async component completes before the next sibling begins, so
lifecycle callbacks retain source registration order.

```mdx
export async function Records() {
  const records = await loadRecords()
  return records.map(record => (
    <Callout kind="note">{record.title}</Callout>
  ))
}

<Records />
```

The runtime awaits the direct component result. Promises nested inside the
resolved value remain invalid; combine them into the direct result with
`Promise.all`.

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

The lowerer wraps phrasing intrinsics returned at root or block level in a
paragraph. A component can therefore return `<strong>` as a top-level value,
and the resulting tree still satisfies paragraph child validation.

The runtime validates an existing MDAST root returned as a document value. At
root or block level, its children are spliced into the surrounding sequence.
Existing non-root nodes retain their object identity during the mutable phase,
and each node object may appear at one location.

## Document lifecycle

`executeDocument` creates an isolated state for each entry invocation using
`AsyncLocalStorage`. Concurrent document executions use separate callback
queues.

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
| Render | Construction values are being evaluated | Register `onTransform` and `onReady`; evaluate expressions |
| Transform | Complete baseline root, mutable | Rewrite, insert, remove, or annotate MDAST |
| Validation/freeze | Internal transition | Enforce final tree structure and node uniqueness |
| Ready | Complete root, deeply read-only | Inspect, serialize, publish, or perform I/O |
| Closed | Invocation finished | No callback registration |

Registration is legal only during render. Calling `onTransform` or `onReady`
outside a running document, or trying to register another callback from a
transform/ready callback, produces `ERR1301`.

## Transform callbacks

`onTransform(callback)` queues mutable work for the complete baseline tree.

```ts
interface TransformContext {
  root: mdast.Root
}
```

Callbacks run in registration order and are awaited one at a time. Every
callback sees changes made by earlier callbacks.

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

The callback may use any MDAST or unist utility. If it creates an
invalid node, reuses a node object, puts a node in the wrong context, or leaves
an invalid field, final validation rejects the entry after all transforms have
run.

Transform callbacks may be asynchronous. The runtime waits for each callback's
returned promise to settle before starting the next callback.

## Ready callbacks

`onReady(callback)` queues ready-lifetime work.

```ts
interface ReadyContext {
  readonly root: DeepReadonly<mdast.Root>
}
```

The root has passed validation and is deeply frozen before the first callback
runs. Ready callbacks are awaited sequentially in registration order. They can
serialize, write files, publish, perform network operations, or call any
library. The frozen root prevents document mutation during this phase.

```mdx
import {onReady} from '@markscript/markscript'
import {writeFile} from 'node:fs/promises'

{
  onReady(async ({root}) => {
    await writeFile('document.json', JSON.stringify(root, null, 2))
  })
}
```

The document entry resolves after every asynchronous ready callback completes.
A callback exception rejects the entry with standard JavaScript error
semantics. Under `markscript run`, CLI formatting and stdout output occur after
the complete lifecycle resolves.

## Final data and deep freezing

The final graph may contain scalar values, arrays, and plain objects whose
prototype is `Object.prototype` or `null`. `ERR1201` rejects accessor
properties, functions, class instances, maps, sets, dates, response objects,
and other values outside the deeply read-only document data model.

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

Directive attachments created by `attach` may initially contain live evaluated
values so a transform can consume them. The transform must replace functions,
class instances, and other non-document values with plain readable data, or
remove that metadata, before final validation and freezing.

Validation separately enforces node uniqueness: a node object may occur only
once. Metadata object identity remains ordinary data structure. For portability,
avoid metadata cycles because JSON and Markdown adapters can fail to serialize
them; CLI formatting failures carry `ERR2101`.

## Removing metadata

`stripData(tree)` returns a detached copy with every MDAST node's `data` field
removed and leaves the input unchanged. This supports use with frozen final
roots.

```ts
import {stripData} from '@markscript/markscript'

const portable = stripData(root)
```

Arrays, positions, node fields, and plain nested records are copied. The helper
uses a visited-object map to terminate recursion through shared non-node
metadata. Its implementation is `packages/runtime/src/data.ts`.

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

Use `markscript help CODE` for the indexed manual entry for a diagnostic code
emitted by MarkScript.

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
