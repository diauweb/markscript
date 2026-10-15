# HBK1001 — Language syntax and the MDAST model

MarkScript is a document programming language with Markdown syntax.
Source files use `.ms`, MDX syntax, and TypeScript/TSX for each embedded code region.
Document execution makes one `mdast.Root`, the language's normal form.

This handbook is the language reference. `markscript_design.md` contains the full product contract.
Parser implementations are in `packages/compiler/src/parser.ts` and `packages/compiler/src/generate.ts`.
Runtime normalization and structural rules are in `packages/runtime/src/lower.ts` and `packages/runtime/src/validate.ts`.

## The five source forms

| Source form | Meaning | Execution point |
|---|---|---|
| Markdown | Static text and structure | Document rendering |
| Directive | Inline, flow, or group metadata attachment | MDAST conversion |
| `{ expression }` | TypeScript expression with a value that can add content | Document rendering |
| `<lowercase>` | Built-in JSX constructor with Markdown semantics | Document rendering |
| `<Uppercase>` | TypeScript component function | Evaluation of its JSX occurrence |

A full module can mix all five:

```mdx
import {onReady, onTransform} from '@markscript/markscript'

export const title = 'Quarterly report'

export function Note({children}: {children?: unknown}) {
  return <blockquote><strong>Note: </strong>{children}</blockquote>
}

# {title}

::status{audience=reviewers}
::ref{id=summary visibility=public}

Draft.

<Note>Generated with **MarkScript**.</Note>

{
  onTransform(({root}) => {
    root.data = {...root.data, reviewed: true}
  })
}

{
  onReady(({root}) => {
    console.error(`${root.children.length} top-level nodes`)
  })
}
```

Imports, named exports, functions, expressions, and component bodies use TypeScript. Markdown regions use Markdown syntax.
Lowercase JSX contains only elements with standard Markdown/MDAST meanings.

## Consumer fences

A code fence with a language label is a standard MDAST `code` node.
Consumers select it by `type` and `lang`, read `value`, and replace it during a standard transform.
The core keeps the body as literal code.

````md
```diagram
<svg viewBox="0 0 10 10"><text>Release</text></svg>
```
````

## Directive attachment

MarkScript uses `remark-directive` syntax for short named metadata:

```mdx
:::callout{#release .warning audience="agent"}
## Release status

Ready.
:::

::badge{tone=success}

Ready.

The :abbr{title="HyperText Markup Language"}**HTML** specification.
```

The `:` and `::` forms attach to the next phrasing or flow node.
These zero-width forms reject bracket labels.
The `:::` form annotates each directly contained flow node. Then it disappears and leaves no group node or identity.

Attributes without inner braces become strings. Bare attributes become `true`.
Inner braces contain TypeScript expressions. Double braces represent an object literal:

```mdx
export const shared = {keepWithNext: true}

::layout{spacing={{after: 120}} {...shared}}

## Result
```

## Module code and document code

ESM imports and source-level exports execute during JavaScript module initialization.
The generated async entry contains Markdown, content expressions, document component invocations, and lifetime callback registration.

```mdx
import {loadSettings} from './settings.ts'

export const title = loadSettings().title

export function label(value: number) {
  return `Item ${value}`
}

# {title}

{label(3)}
```

An import of this module initializes `title` and `label`. A call to the generated default export starts rendering and makes the heading.

The compiler generates the default export. A `.ms` source can define named value, function, class, and type exports.
The compiler rejects source-level default declarations and reexports.
Module-scope TypeScript declarations must have `export` under the MDX grammar.
Put non-exported declarations in an imported `.ts` or `.tsx` module.

## TypeScript expressions

The parser processes each expression region as TypeScript/TSX.
Type annotations, generics, `satisfies`, type assertions, optional chaining, and awaited expressions are available where TypeScript permits them.

```mdx
{records
  .filter((record): record is ReportRecord => record.visible)
  .map(record => <p>{record.title satisfies string}</p>)}
```

An expression evaluates with standard JavaScript semantics. The renderer implicitly waits for its result before MarkScript document value interpretation.
Convert objects explicitly to supported values. A promise inside an array or another construction value causes an error.
Use `Promise.all` to combine nested promises into the expression result.

The compiler rejects explicit top-level `await` in document expressions and
JSX attributes. Nested async functions can use `await`.

## Document value normalization

The runtime accepts the `MarkValue` union declared in
`packages/runtime/src/types.ts`.

| Value | Result |
|---|---|
| `null`, `undefined`, `false`, or `void` | No document content |
| String or number in phrasing content | MDAST `text` node |
| String or number at root or flow level | `paragraph` with a `text` node |
| Array or fragment | Recursive flattening in order |
| Lowercase JSX value | Conversion to its defined MDAST node |
| Uppercase component result | Promise resolution and recursive MarkValue normalization |
| Existing MDAST node or root | Validation before insertion |
| `true` | Error. Only `false` is the empty boolean value |
| Direct expression promise | Implicit await before MDAST conversion |
| Promise inside another value | Error. Use `Promise.all` to combine promises |
| Other object or function | Error. Explicit conversion to a supported value is necessary |

Arrays can contain any mixture of supported values. The runtime flattens them in order.
A root inserted at root or block level gives its children. Root values are valid only at root or block level.

## Markdown-shaped JSX vocabulary

`JSX.IntrinsicElements` in `packages/runtime/src/jsx-runtime.ts` declares the intrinsic contract.
`packages/runtime/src/intrinsics.ts` and `packages/runtime/src/lower.ts` implement runtime prop checks.

| JSX | MDAST output | Allowed props |
|---|---|---|
| `<h1>` through `<h6>` | `heading` with depth 1 through 6 | None |
| `<p>` | `paragraph` | None |
| `<em>` | `emphasis` | None |
| `<strong>` | `strong` | None |
| `<a>` | `link` | Required `href`, optional `title` |
| `<img />` | `image` | Required `src` and `alt`, optional `title` |
| `<blockquote>` | `blockquote` | None |
| `<ul>` | Unordered `list` | None |
| `<ol>` | Ordered `list` | Optional non-negative integer `start` |
| `<li>` | `listItem` | None |
| `<br />` | `break` | None. No children |
| `<hr />` | `thematicBreak` | None. No children |
| `<code>` | Phrasing `inlineCode` | None |
| `<pre><code>` | Block `code` | None |
| `<>...</>` | Flattened fragment | Only `children` |

`<pre>` must contain exactly one direct `<code>` child.
Code content can contain only strings, numbers, text nodes, arrays, and fragments.
The runtime rejects JSX keys and unlisted attributes because MDAST has no corresponding fields.

For groups, use a fragment. For reuse or domain behavior, use an uppercase component.
For metadata, use a directive.
The core intrinsic vocabulary excludes elements such as `<article>` and attributes such as `className` or `target`.

## Components

An uppercase JSX name resolves to a TypeScript function. The function executes at its JSX evaluation point and returns another MarkValue.

```mdx
export function Section(
  {title, children}: {title: string; children?: unknown}
) {
  return (
    <>
      <h2>{title}</h2>
      {children}
    </>
  )
}

<Section title="Results">
The result is **42**.
</Section>
```

Components can return a document value or a promise. MarkScript resolves children before their parent and siblings from left to right.
It waits for each component before the next starts.
Put reusable algorithms and complex types in imported `.ts` or `.tsx` modules.

## Flow and phrasing contexts

MDAST defines which children each parent accepts.
The compiler checks statically visible structure. The runtime validates each dynamic value again.

| Context | Accepted content |
|---|---|
| Root | Blocks, definitions, and YAML frontmatter |
| Block/flow container | Blocks and definitions |
| Paragraph or heading | Phrasing nodes |
| Link | Phrasing nodes except another link |
| List | `listItem` nodes only |
| Table | `tableRow` nodes only |
| Table row | `tableCell` nodes only |

This is invalid because a heading is flow content inside a paragraph's
phrasing context:

```mdx
This sentence contains {<h2>A nested heading</h2>}.
```

Programmatically inserted MDAST uses the same rules. Links exclude other links. Lists accept `listItem` children.
A root appears only as a top-level value or a value at root or block level.

## Directives and `node.data`

An inline or flow directive is a pending zero-width attachment.
It targets the next compatible emitted node in the same MDAST conversion sequence.
The target stores directive attributes in `node.data`.

```mdx
::ref{id=introduction visibility=public}
::style{role=lead}

## Introduction
```

The directive name becomes a key in `node.data`. Attributes become its value.
Named expressions and spreads evaluate in source order with JavaScript object-literal replacement semantics.

```js
{
  type: 'heading',
  depth: 2,
  children: [{type: 'text', value: 'Introduction'}],
  data: {
    ref: {id: 'introduction', visibility: 'public'},
    style: {role: 'lead'}
  }
}
```

Consecutive attachments in the same namespace use a shallow merge. Later values have priority.
An attachment completes when it finds a target. A pending attachment at the end of its sequence causes an error.
Attacher directives cannot have bracket labels.

The unist `data` object stores metadata for exchange between MarkScript and its libraries.
The core ignores unknown namespaces. Libraries must keep keys from other producers.

## The accepted MDAST normal form

The runtime validator accepts these node families as programmatic input, including forms without a direct lowercase JSX constructor.

| Family | Node types |
|---|---|
| Document | `root` |
| Blocks | `blockquote`, `code`, `heading`, `html`, `list`, `paragraph`, `table`, `thematicBreak` |
| Definitions | `definition`, `footnoteDefinition` |
| Frontmatter | `yaml` |
| Phrasing | `break`, `delete`, `emphasis`, `footnoteReference`, `html`, `image`, `imageReference`, `inlineCode`, `link`, `linkReference`, `strong`, `text` |
| Structural children | `listItem`, `tableRow`, `tableCell` |

The source frontend uses `remark-parse`, `remark-gfm`, `remark-directive`, and `remark-mdx`.
Source syntax includes CommonMark, GFM tables, deletion, task lists, autolinks, footnotes, directives, and MDX forms.
Components or transforms can also return YAML as typed MDAST.
The CLI Markdown serializer has corresponding GFM, directive, and frontmatter extensions.

## Tree structure invariants

The final root follows these structural rules:

- Each node has a recognized `type` and the required fields for that type.
- Children obey their parent's MDAST content context.
- Each node object appears at exactly one path.
- Node ancestry contains no cycles.
- Positions, resources, references, table alignment, and optional fields have their declared structures.
- `data`, if present, is an object.
- Final values contain only scalars, arrays, and plain objects without accessors or functions.

All transform callbacks complete before final validation.
The runtime deeply freezes the validated tree before ready callbacks and document entry resolution.
Consumers receive standard MDAST and can use unified and unist libraries directly.

## Implementation references

| Question | Source |
|---|---|
| What syntax is accepted? | `packages/compiler/src/parser.ts` |
| How is source converted into the generated TSX module? | `packages/compiler/src/generate.ts` |
| What can an expression or component return? | `packages/runtime/src/types.ts` |
| How do intrinsics lower? | `packages/runtime/src/lower.ts` |
| How do annotations attach and merge? | `packages/runtime/src/annotations.ts` |
| Which final nodes and fields are legal? | `packages/runtime/src/validate.ts` |
| What is the product-level contract? | `markscript_design.md` |

If this handbook and the implementation disagree, verify the source.
Update the implementation, design document, and manual together.
Use the current contract for unshipped APIs, without aliases, migrations, or compatibility behavior.