# HBK1001 — Language syntax and the MDAST model

MarkScript is a Markdown-first document programming language. A source file has
the extension `.ms`, follows MDX-shaped Markdown syntax, and uses
TypeScript/TSX for every embedded code region. Executing the document produces
one `mdast.Root`, the language's normal form.

This handbook is the language-level reference. The complete product contract is
in `markscript_design.md`. Parser details are implemented in
`packages/compiler/src/parser.ts` and `packages/compiler/src/generate.ts`;
runtime normalization and structural rules are implemented in
`packages/runtime/src/lower.ts` and `packages/runtime/src/validate.ts`.

## The five source forms

| Source form | Meaning | When it runs |
|---|---|---|
| Markdown | Static prose and structure | During document rendering |
| Directive | Inline, flow, or grouped metadata attachment | During lowering |
| `{ expression }` | TypeScript expression whose value may contribute content | During document rendering |
| `<lowercase>` | A built-in Markdown-shaped JSX constructor | During document rendering |
| `<Uppercase>` | A TypeScript component function | When its JSX occurrence is evaluated |

A complete module can mix all five:

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

The imports, named exports, functions, expressions, and component bodies are
TypeScript. Markdown regions use Markdown syntax. Lowercase JSX is limited to
elements with canonical Markdown/MDAST meaning.

## Consumer fences

A language-labelled code fence is an ordinary MDAST `code` node. Consumers
select the node by `type` and `lang`, read its `value`, and replace it during a
normal transform. Core does not parse or dispatch the body.

````md
```diagram
<svg viewBox="0 0 10 10"><text>Release</text></svg>
```
````

## Directive attachment

MarkScript uses `remark-directive` syntax for compact named metadata:

```mdx
:::callout{#release .warning audience="agent"}
## Release status

Ready.
:::

::badge{tone=success}

Ready.

The :abbr{title="HyperText Markup Language"}**HTML** specification.
```

The `:` and `::` forms attach to the next phrasing or flow node. They are
zero-width and reject bracket labels. The `:::` form annotates every directly
contained flow node and then disappears, leaving no group node or identity.

Attributes without inner braces become strings, and bare attributes become
`true`. Inner braces contain TypeScript expressions; double braces naturally
represent an object literal:

```mdx
export const shared = {keepWithNext: true}

::layout{spacing={{after: 120}} {...shared}}

## Result
```

## Module code and document code

ESM imports and source-level exports run during JavaScript module
initialization. The generated async document entry contains Markdown, content
expressions, document component invocations, and lifetime callback
registration.

```mdx
import {loadSettings} from './settings.ts'

export const title = loadSettings().title

export function label(value: number) {
  return `Item ${value}`
}

# {title}

{label(3)}
```

Importing this module initializes `title` and `label`. Calling the generated
default export starts document rendering and produces the heading.

The compiler generates the default export. A `.ms` source can define named
value, function, class, and type exports. A source-level default declaration or
default re-export is rejected. Following the MDX-shaped grammar, module-scope
TypeScript declarations require `export`; non-exported declarations belong in
an imported `.ts` or `.tsx` module.

## TypeScript expressions

Every expression region is parsed as TypeScript/TSX. Type annotations,
generics, `satisfies`, type assertions, optional chaining, and awaited
expressions are available where TypeScript permits them.

```mdx
{records
  .filter((record): record is ReportRecord => record.visible)
  .map(record => <p>{record.title satisfies string}</p>)}
```

An expression is evaluated with standard JavaScript semantics and its result is
implicitly awaited before being interpreted as a MarkScript document value.
Convert objects explicitly to supported document values. A promise nested
inside an array or another construction value is an error; combine nested
promises into the expression's result with `Promise.all`.

The compiler rejects explicit top-level `await` in document expressions and
JSX attributes. Nested async functions can use `await`.

## Document value normalization

The runtime accepts the `MarkValue` union declared in
`packages/runtime/src/types.ts`.

| Value | Result |
|---|---|
| `null`, `undefined`, `false`, or `void` | No document content |
| String or number in phrasing content | An MDAST `text` node |
| String or number at root or flow level | A `paragraph` containing a `text` node |
| Array or fragment | Recursively flattened in order |
| Lowercase JSX value | Lowered to its defined MDAST node |
| Uppercase component result | Awaited and normalized recursively as another MarkValue |
| Existing MDAST node or root | Validated before insertion |
| `true` | Rejected; only `false` is the empty boolean value |
| Promise returned directly by an expression | Implicitly awaited before lowering |
| Promise nested inside another value | Rejected; combine nested promises with `Promise.all` |
| Other object or function | Rejected; requires explicit conversion to a supported value |

Arrays may contain any mixture of supported values and are flattened in order.
A root inserted at root or block level contributes its children. Root values
are valid only at root or block level.

## Markdown-shaped JSX vocabulary

The intrinsic contract is declared by `JSX.IntrinsicElements` in
`packages/runtime/src/jsx-runtime.ts`. Runtime prop checks are implemented in
`packages/runtime/src/intrinsics.ts` and `packages/runtime/src/lower.ts`.

| JSX | MDAST output | Allowed props |
|---|---|---|
| `<h1>` through `<h6>` | `heading` with depth 1 through 6 | none |
| `<p>` | `paragraph` | none |
| `<em>` | `emphasis` | none |
| `<strong>` | `strong` | none |
| `<a>` | `link` | required `href`, optional `title` |
| `<img />` | `image` | required `src` and `alt`, optional `title` |
| `<blockquote>` | `blockquote` | none |
| `<ul>` | unordered `list` | none |
| `<ol>` | ordered `list` | optional non-negative integer `start` |
| `<li>` | `listItem` | none |
| `<br />` | `break` | none; no children |
| `<hr />` | `thematicBreak` | none; no children |
| `<code>` | phrasing `inlineCode` | none |
| `<pre><code>` | block `code` | none |
| `<>...</>` | flattened fragment | only `children` |

`<pre>` must contain exactly one direct `<code>` child. Code content may
contain only strings, numbers, text nodes, arrays, and fragments. JSX keys and
unlisted attributes are rejected because MDAST has no corresponding fields for
them.

For grouping, use a fragment. For reuse or domain behavior, use an uppercase
component. For metadata, use a directive. The core intrinsic vocabulary
excludes elements such as `<article>` and attributes such as `className` or
`target`.

## Components

An uppercase JSX name resolves to a TypeScript function. The function runs when
its JSX occurrence is evaluated and returns another MarkValue.

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

Components may return a document value directly or return a promise. MarkScript
resolves child components before their parent and resolves siblings
left-to-right, awaiting each component before starting the next. Place reusable
algorithms and complex types in imported `.ts` or `.tsx` modules.

## Flow and phrasing contexts

MDAST constrains which children can appear under each parent. MarkScript checks
the statically visible structure in the compiler and validates every dynamic
value again at runtime.

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

Programmatically inserted MDAST follows the same rules. Link children exclude
links, list children are `listItem` nodes, and a root appears only as the
top-level value or as a value inserted at root or block level.

## Directives and `node.data`

An inline or flow directive is a pending, zero-width attachment. It targets the
next compatible emitted node in the same lowering sequence. The attached node
stores the directive attributes in `node.data`.

```mdx
::ref{id=introduction visibility=public}
::style{role=lead}

## Introduction
```

The directive name becomes a key in `node.data`; attributes become its value.
Named expressions and spreads are evaluated in source order with JavaScript
object-literal replacement semantics.

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

Consecutive attachments with the same namespace shallow-merge. Later values
win. Pending attachments are consumed when attached; leaving one at the end of
its sequence is an error. Attacher directives cannot have bracket labels.

The unist `data` object stores metadata exchanged by MarkScript and
MarkScript-aware libraries. Core ignores unrecognized namespaces. Libraries
should preserve keys added by other producers.

## The accepted MDAST normal form

The runtime validator accepts the following node families as programmatic
input, including forms with no direct lowercase JSX constructor.

| Family | Node types |
|---|---|
| Document | `root` |
| Blocks | `blockquote`, `code`, `heading`, `html`, `list`, `paragraph`, `table`, `thematicBreak` |
| Definitions | `definition`, `footnoteDefinition` |
| Frontmatter | `yaml` |
| Phrasing | `break`, `delete`, `emphasis`, `footnoteReference`, `html`, `image`, `imageReference`, `inlineCode`, `link`, `linkReference`, `strong`, `text` |
| Structural children | `listItem`, `tableRow`, `tableCell` |

The source frontend uses `remark-parse`, `remark-gfm`, `remark-directive`, and
`remark-mdx`. Core CommonMark, GFM tables, deletion, task lists, autolinks,
footnotes, directive attachment, and the MDX-shaped forms are source syntax. YAML
may also be returned by components or transforms as typed MDAST. The CLI
Markdown serializer has matching GFM, directive, and frontmatter extensions.

## Tree structure invariants

The final root follows these structural rules:

- every node has a recognized `type` and the fields required for that type;
- children obey their parent's MDAST content context;
- each node object appears at exactly one path;
- cyclic node ancestry is forbidden;
- positions, resources, references, table alignment, and optional fields have
  their declared shapes;
- `data` is an object when present;
- final values contain only scalar values, arrays, and plain objects without
  accessors or functions.

All transform callbacks complete before final validation. The validated tree is
then deeply frozen before ready callbacks and before the document entry resolves.
Consumers receive standard MDAST and can use unified and unist libraries
directly.

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

When implementation and this handbook disagree, verify the source and update
the implementation, design document, and manual together. Unshipped APIs have
no aliases, migrations, or compatibility behavior.
