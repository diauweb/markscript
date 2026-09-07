# MarkScript
## Design Document

> **One-line definition:** MarkScript is a Markdown-first document programming language with TypeScript/TSX code, MDX-shaped syntax, and MDAST as its normal form.

MarkScript keeps ordinary Markdown readable, uses TypeScript when computation is needed, uses JSX as a constrained DSL for constructing Markdown-representable structure, and exposes document lifetime callbacks for non-local transformations and ordinary program side effects.

The canonical source extension is **`.ms`**, in the same spirit that `.md` identifies Markdown.

MarkScript is designed for two equally important environments:

1. **Module use** — `.ms` files compile to importable ESM modules with a default document entry function and ordinary named exports.
2. **Dedicated language use** — `.ms` files execute through the MarkScript compiler/runner and CLI.

The runtime and programmatic document boundary is intentionally thin. Format conversion, network access, databases, filesystem output, and other domain behavior are ordinary TypeScript libraries imported and called directly from MarkScript programs or host code. The CLI may present a finalized root as Markdown, MDAST JSON, or human-friendly terminal output without changing that boundary.

---

# 1. Motivation

Markdown is excellent for document structure and prose, while TypeScript supplies the computational layer. MDX already established a readable way to interleave Markdown, JSX, expressions, and modules. MarkScript adopts that surface model and uses **MDAST** as the resulting document representation.

The intended use cases include:

- generated technical documents and reports;
- reusable document components;
- AST annotation and transformation;
- data-driven documents;
- linting and compiler-like document processing;
- external renderers and converters implemented as normal libraries;
- programs whose main value is a document but which may also perform ordinary I/O.

A typical `.ms` file should still look mostly like Markdown:

```mdx
import {onReady} from '@markscript/markscript'
import {writeFile} from 'node:fs/promises'
import {serialize} from './my-renderer.ts'

# Quarterly report

::style{role=lead color=accent}

The quarter closed with **strong growth**.

{items.map(item => (
  <blockquote>
    <strong>{item.name}</strong>
    <p>{item.summary}</p>
  </blockquote>
))}

{
  onReady(async ({root}) => {
    await writeFile('report.out', await serialize(root))
  })
}
```

`writeFile` and `serialize` are ordinary TypeScript/JavaScript functions called at a well-defined point in the document lifetime.

---

# 2. Goals

## 2.1 Primary goals

- Keep the source grammar as close to MDX as practical.
- Use **`.ms`** as the canonical MarkScript source extension.
- Treat all code islands as **TypeScript/TSX syntax**.
- Let the project or CLI configuration choose the TypeScript type-checking profile.
- Make MDAST the canonical output and interoperability boundary.
- Treat JSX as a constrained constructor DSL for Markdown-representable structure.
- Allow ordinary TypeScript functions and libraries to run normally.
- Interoperate directly with standard unist selection and traversal libraries for non-local AST work.
- Make directives a generic annotation mechanism over `node.data`.
- Keep consumer source in ordinary language-labelled fenced code nodes.
- Reserve the entire MDAST/unist `data` object for MarkScript and its libraries.
- Keep the runtime document value and programmatic ABI independent of output formatting and application-specific behavior.
- Provide first-class **check**, **compile**, and **run** modes.

## 2.2 Scope boundaries

MarkScript has these boundaries:

- The surface language follows the Markdown + TypeScript/TSX shape described in this document.
- Lowercase JSX intrinsics are limited to forms with defined Markdown/MDAST semantics.
- Application side effects use ordinary TypeScript execution at defined document lifetimes.
- Application-specific format conversion and behavior live in ordinary libraries; the CLI's standard output presentations are adapters over the finalized MDAST.
- Type-checking policy is configurable.
- Round-tripping is defined at the semantic MDAST level.
- `run` assumes trusted program execution unless the host provides an isolation boundary.

---

# 3. Core design principles

## 3.1 MDX-shaped surface, MarkScript semantics

MarkScript reuses GFM's readable Markdown extensions, generic directive syntax,
and the proven JSX and expression shape of MDX as its source model.

Conceptually:

```text
GFM Markdown + generic directives + TypeScript expressions + TSX
                  |
                  v
             MarkScript
                  |
                  v
                MDAST
```

MarkScript supplies its own JSX runtime and document lifetime model, producing MDAST as the document value.

## 3.2 TypeScript is the code language

Code inside `.ms` is always interpreted as TypeScript/TSX syntax, including expression forms such as type assertions, generic calls, `satisfies`, and type-only module syntax where the surrounding MDX-shaped form permits module declarations.

Type-checking strictness is a project-level policy layered on top of this syntax choice.

The language toolchain must:

- parse/transpile code islands as TypeScript/TSX;
- ship precise type declarations for its runtime and JSX vocabulary;
- provide `markscript check` for type checking;
- respect the host project's `tsconfig.json` when compiled as part of a project;
- allow standalone configuration to choose TypeScript compiler options;
- use the configured TypeScript compiler options for checking.

`run` and `compile` support transpile-first workflows; `check` always performs type analysis.

## 3.3 MDAST is the normal form

A completed document returns an ordinary `mdast.Root`.

After successful materialization, the returned tree contains ordinary MDAST content nodes, with MarkScript metadata represented through `node.data` where needed.

## 3.4 Application effects use ordinary TypeScript

A JavaScript/TypeScript function is executed as a normal function.

```mdx
{console.error('rendering section')}
```

works because `console.error` executes normally and returns `void`, which contributes no document content. `console.log` is equally ordinary, but under `markscript run` it writes to the same stdout stream reserved for document output. Source-side logging should use stderr when a clean machine-readable document stream matters.

The language defines document lifetime points at which ordinary TypeScript code runs.

## 3.5 Libraries are ordinary TypeScript modules

Libraries are imported and called as ordinary TypeScript modules:

```mdx
import {Warning} from '@acme/document-components'
import {normalizeReferences} from '@acme/document-tools'

<Warning>Check this section.</Warning>

{
  onTransform(({root}) => {
    normalizeReferences(root)
  })
}
```

The fixed lowercase JSX vocabulary defines core Markdown constructors. Reusable document abstractions use ordinary uppercase TSX components. Directives provide open metadata. Document lifetime semantics are part of the core language contract; selection and traversal use ordinary unist libraries.

---

# 4. Thin core boundary

The core contains only capabilities required to define the language itself.

## 4.1 Core responsibilities

1. `.ms` source loading and GFM/directive/MDX-shaped parsing.
2. TypeScript/TSX parsing/transpilation for code islands.
3. MarkScript JSX runtime (`Fragment`, `jsx`, `jsxs`, `jsxDEV`).
4. Directive attachment and group flattening into MDAST `data`.
5. Markdown-shaped intrinsic lowering to MDAST.
6. Ordinary language-labelled fenced code nodes for consumer-owned source.
7. Document lifetime callbacks: `onTransform` and `onReady`.
8. Final MDAST validation.
9. `compile`, `check`, and `run` APIs/CLI behavior.

## 4.2 Outside core

These are ordinary TypeScript libraries and remain outside the language core:

- DOCX/PDF/HTML conversion;
- filesystem writes;
- network requests;
- database access;
- diagram rendering;
- citation engines;
- template systems;
- application-specific style resolvers;
- publishing systems.

Libraries consume or mutate MDAST through ordinary imports and function calls.

Output libraries preserve common Markdown concepts instead of introducing
format-specific JSX components for them. In the DOCX library, authored prose
uses ordinary Markdown paragraphs. `::docx{style=ReportBody}` binds a string
value to the next paragraph; `::docx{options={data}}` binds a computed value.
An empty paragraph is authored explicitly as `<p />`.

DOCX resolution applies every recognized directive namespace attached to a
node. Explicit `data.docx` values retain precedence. Boolean directive options
accept bare attributes, boolean expressions, and quoted `true` or `false`.

The published `@markscript/docx` runtime bundles the patched `docx` engine so
character indentation, line-based paragraph spacing, and custom styles merged
with external styles behave consistently in workspace and installed builds.
Its `docx` dependency supplies the exported option types.

---

# 5. Language surface

MarkScript has five visible source forms, all compatible with the MDX-shaped model.

| Form | Meaning |
|---|---|
| GFM Markdown | Static document structure and prose, including tables, strikethrough, task lists, autolinks, and footnotes |
| `:name`, `::name`, `:::name` | Inline attacher, flow attacher, and flattened flow group |
| `{ expression }` | TypeScript expression; its return value may contribute content |
| `<lowercase>` | Built-in Markdown-shaped JSX constructor |
| `<Uppercase>` | User TypeScript component / compile-time document macro |

Example:

```mdx
export function Warning({children}: {children?: unknown}) {
  return (
    <blockquote>
      <strong>Warning: </strong>
      {children}
    </blockquote>
  )
}

# Safety

::style{role=warning color=accent}

<Warning>
Preserve the production database.
</Warning>
```

## 5.1 Directive attachment

Directives attach named data with a compact Markdown surface:

```mdx
:::callout{#release .warning audience="agent"}
## Release status

Deployment is ready.
:::

::badge{tone=success}

Ready.

The :abbr{title="HyperText Markup Language"}**HTML** specification.
```

The one-colon form is zero-width phrasing data and attaches to the next emitted
phrasing node. The two-colon form is zero-width flow data and attaches to the
next emitted flow node. Labels (`[]`) are invalid on both forms.

The three-colon form is a flow group. It attaches the group namespace and
attributes to every directly emitted child, then flattens those children into
the parent. The group leaves no node, ID, range record, or other trace in the
final MDAST. Nested groups merge their data onto the affected nodes.

Directive attributes without inner braces are strings; a bare attribute is
`true`. Inner braces use the same TypeScript/TSX expression grammar as JSX,
including nested object literals and ordered spreads:

```tsx
export const shared = {keepWithNext: true}

::layout{spacing={{after: 120}} {...shared}}

## Result
```

Consecutive attachers in the same namespace shallow-merge, with later
properties winning. A pending attacher that reaches the end of its local
sequence is an error.

---

# 6. Runtime value model

The JSX runtime builds a small internal value graph before MDAST lowering.

```ts
type MarkValue =
  | MarkElement
  | MarkFragment
  | MarkComponent
  | MarkAnnotation
  | MarkGroup
  | MdastNode
  | MdastNode[]
  | string
  | number
  | boolean
  | null
  | undefined
```

`MarkComponent` is an internal lazy component invocation. Before MDAST
lowering, the runtime resolves component children and then invokes components
depth-first and left-to-right. A component may return `MarkValue`, `void`, or a
promise of either. Each component result resolves completely before the next
sibling component begins, preserving lifecycle registration and source order.

`Promise` is deliberately absent from the resolved `MarkValue` graph. Every
document expression, JSX attribute expression, and JSX spread expression is an
implicit async boundary: the compiler awaits that expression's result inside
the generated document renderer. The runtime also awaits each direct component
result during ordered component resolution before MDAST lowering.

Explicit top-level `await` is rejected in module declarations and at document
or JSX attribute expression boundaries. `await` remains ordinary TypeScript
inside a nested async function.

Implicit await resolves the direct expression result. Promises stored inside an
array or another construction value remain unresolved. Use
`Promise.all(...)` when an expression produces an array of promises; the
expression boundary then awaits the combined promise.

Document side effects that need a stable document state use the lifetime callbacks described in Section 11.

## 6.1 Primitive normalization

- `null`, `undefined`, and `false` emit nothing.
- strings and numbers in phrasing context become text nodes.
- strings and numbers in flow/root context become paragraphs containing text.
- arrays are flattened.
- MDAST values are validated before insertion.
- a promise remaining inside an array, fragment, resolved component result, or
  MDAST value is rejected;
- unsupported objects are rejected without implicit stringification.
- ordinary side effects happen according to normal TypeScript/JavaScript execution semantics.

---

# 7. Markdown-shaped JSX

## 7.1 Core intrinsic vocabulary

The lowercase intrinsic set is deliberately small and Markdown-shaped.

| JSX | MDAST |
|---|---|
| `<h1>` ... `<h6>` | `heading` |
| `<p>` | `paragraph` |
| `<em>` | `emphasis` |
| `<strong>` | `strong` |
| `<a href title?>` | `link` |
| `<img src alt title?>` | `image` |
| `<blockquote>` | `blockquote` |
| `<ul>` | unordered `list` |
| `<ol start?>` | ordered `list` |
| `<li>` | `listItem` |
| `<br />` | `break` |
| `<hr />` | `thematicBreak` |
| `<code>` | `inlineCode` in phrasing context |
| `<pre><code>` | block `code` |
| `<>...</>` | fragment |

Examples:

```tsx
<h3>Hello <em>world</em></h3>
<a href="/spec" title="Specification">spec</a>
```

Rejected by core:

```tsx
<div className="panel">...</div>
<h2 className="red">Heading</h2>
<a href="/x" target="_blank">x</a>
```

The intrinsic vocabulary is defined by canonical Markdown/MDAST meaning.
The three directive constructors accept a required directive `name`, ordinary
directive attributes, and children valid for the corresponding directive
content context.

## 7.2 Static typing

MarkScript ships JSX type declarations for supported intrinsic elements and their properties. This allows a TypeScript-aware editor/checker to catch many invalid tags or attributes before execution.

Runtime validation remains required because documents may be transpiled without a type-check pass and values can be dynamic.

## 7.3 Context validation

The lowerer enforces MDAST flow/phrasing constraints. Links and reference links
cannot contain another link or reference link, including through emphasis,
strong text, strikethrough, or text-directive wrappers. The same rule applies
when validating externally supplied MDAST and the finalized document.

```mdx
This is invalid: {<h2>Nested heading</h2>}
```

produces a diagnostic because phrasing content excludes flow headings.

---

# 8. Components are the macro system

Uppercase JSX names are ordinary TypeScript values, normally functions.

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

The function runs while the document is being built and returns MarkScript
document values. Components may be asynchronous. Child components resolve
before their parent component is invoked, and sibling components resolve
left-to-right without concurrency.

Within a MarkScript document, a default entry imported from another `.ms` file
is composed as an uppercase JSX component. Its asynchronous entry resolves to
an MDAST root, whose children are inserted into the surrounding flow content.

```mdx
import Appendix from './sections/appendix.ms'

<Appendix />
```

This provides language-native macros through ordinary TypeScript components.

Large algorithms and reusable types should normally live in imported `.ts`/`.tsx` modules.

---

# 9. Directive data and consumer fences

## 9.1 Direct mapping into `node.data`

The entire `data` object is reserved for MarkScript and MarkScript-aware
libraries. A directive name becomes a top-level key and its attributes become
that key's value:

```md
::ref{id=introduction visibility=public}
::style{role=lead color=accent}

## Introduction
```

lowers to:

```js
{
  type: 'heading',
  depth: 2,
  children: [...],
  data: {
    ref: {id: 'introduction', visibility: 'public'},
    style: {role: 'lead', color: 'accent'}
  }
}
```

The mapping is mechanical:

```text
::foo{a=1 b=x}  ->  nextFlowNode.data.foo = {a: '1', b: 'x'}
:foo{a=1 b=x}   ->  nextPhrasingNode.data.foo = {a: '1', b: 'x'}
```

`::foo{a=1 b={value} nested={{enabled: true}}}` maps to
`{a: '1', b: value, nested: {enabled: true}}`. Attribute order is preserved,
so a spread or later named attribute replaces an earlier property exactly as
it would in a JavaScript object literal.

## 9.2 Group flattening

```md
:::review{audience=internal}
## Result

Paragraph.
:::
```

attaches `data.review` to both the heading and paragraph. They remain direct
siblings in their original parent. No `containerDirective` remains.

## 9.3 MarkScript and library-owned keys

MarkScript-aware code may assign semantics to keys in `node.data`. Core
language behavior that needs persistent metadata uses its own documented keys,
such as `data.compiler`. Other keys are available to ordinary libraries.

## 9.4 Consumer fences

Consumer-owned source uses ordinary fenced code with the consumer name as its
language:

````md
::satori{width=1200 height=630 alt="Release summary"}

```satori
<div style={{display: 'flex'}}>Release</div>
```
````

The finalized node is an ordinary MDAST `code` node with `lang: 'satori'`, its
body in `value`, and the attached options in `data.satori`. Core performs no
special parsing, evaluation, slot substitution, or dispatch. A consumer selects
the code node by `type` and `lang`, interprets `value`, and replaces it during a
normal transform when needed.

---

# 10. Document lifetime

A MarkScript document passes through a small number of stable lifetime states.
The lifetime model defines **when the document exists, when it may be mutated,
and when it is final**. Ordinary TypeScript libraries retain control of their
own tree operations.

## 10.1 Module lifetime

Importing a compiled `.ms` module follows ordinary ESM semantics. Its dependencies are loaded and evaluated, and its module-scope declarations are initialized. Any side effects caused by module initialization therefore happen at import time.

MarkScript separates **module code** from the **document body**:

- ESM imports and source-level exports remain at module scope;
- exported value initializers execute during normal ESM module initialization;
- exported function/class declarations become normal module bindings;
- Markdown, document expressions, TSX document content, and lifetime callback registration are compiled into the generated default document entry function.

MarkScript rejects module-scope `await`. Asynchronous module APIs use exported
async functions; document code returns their promises from expressions and
lets the generated renderer await them.

For example:

```mdx
import {loadConfig} from './config.ts'

export const reportTitle = loadConfig().title

export function formatPeriod(year: number, quarter: number) {
  return `${year} Q${quarter}`
}

# {reportTitle}

{buildReportBody()}
```

is conceptually compiled as:

```ts
import {loadConfig} from './config.ts'

// Runs during ordinary ESM initialization when the module is imported.
export const reportTitle = loadConfig().title

export function formatPeriod(year: number, quarter: number) {
  return `${year} Q${quarter}`
}

async function runDocument(): Promise<MdastRoot> {
  // Compiled form of:
  //
  // # {reportTitle}
  // {buildReportBody()}
}

export default runDocument
```

Therefore:

```ts
import runReport, {reportTitle} from './report.ms'

console.log(reportTitle) // available after normal module initialization

const root = await runReport() // starts document rendering
```

Importing the module executes ordinary ESM initialization as needed. Calling
the generated default export begins rendering the MarkScript document body.

### 10.1.1 Image asset imports

Relative imports of `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, and `.svg` files
are ordinary string-valued ESM imports in a MarkScript module graph:

```mdx
import cover from './assets/cover.jpeg'

<img src={cover} alt="Report cover" />
```

The default import is a base64 `data:` URL with the media type determined by
the file extension. The same rule applies when the import occurs in a `.ts` or
`.tsx` dependency reached from a MarkScript entry. Bundled callable ESM embeds
the asset bytes, so its document result does not depend on the source asset
remaining beside the output module. `run` exposes the same value and therefore
produces the same standard MDAST image URL.

Static checking resolves the asset and types its default export as `string`
without reading it as executable code. Missing files remain ordinary module
resolution errors. Language tooling uses the same resolution rule. Other file
types retain the host module loader's normal semantics; network retrieval and
dynamic resource resolution remain library behavior.

## 10.2 Render lifetime

The default entry function evaluates Markdown content and inline TypeScript
expressions to construct the document value graph. It awaits each document
expression and JSX attribute expression, then resolves lazy TSX components
depth-first and left-to-right. Each component's direct result is awaited before
the next sibling starts. Only the completely resolved synchronous `MarkValue`
graph enters MDAST lowering.

```mdx
{console.error('render started')}

{items.map(item => <p>{item.name}</p>)}
```

Ordinary functions called here execute immediately. Values that are valid MarkScript document values contribute content; `void`, `null`, `undefined`, and `false` contribute no MDAST.

```mdx
{loadSummary()}

{Promise.all(items.map(async item => renderItem(item)))}
```

The first expression implicitly awaits `loadSummary()`. The second explicitly
combines promises nested in an array, after which the expression boundary
awaits the resulting promise. A bare array of promises remains invalid.

The render lifetime ends when baseline MDAST has been fully materialized and all
lifecycle callbacks have been registered. Sequential component resolution
keeps callback registration in component source order even when components
await asynchronous work.

## 10.3 Transform lifetime

The complete baseline MDAST exists and is mutable. Registered transform callbacks execute in registration order. Each callback observes mutations made by earlier callbacks.

After transforms finish, MarkScript validates the tree.

## 10.4 Ready lifetime

The validated document is the canonical `mdast.Root`. It is deeply frozen before registered ready callbacks receive it.

Ready-lifetime code may inspect the document, serialize it, write files, send network requests, or call any other ordinary TypeScript library. Those external operations are normal program behavior outside the MDAST model.

The lifetime sequence is:

```text
ESM import
   |
   v
module initialization
   |
call default entry
   |
   v
render -> baseline MDAST
   |
   v
transform callbacks
   |
   v
validation and deep freeze
   |
   v
ready callbacks -> ordinary program work / I/O
   |
   v
mdast.Root
```

---

# 11. Lifetime callbacks

Lifetime callbacks let source code schedule work for later document states.

MarkScript core defines two callbacks: `onTransform(...)` and `onReady(...)`.

## 11.1 `onTransform(callback)`

`onTransform` is called during render to register a callback for the transform lifetime.

```mdx
import {onTransform} from '@markscript/markscript'
import {selectAll} from 'unist-util-select'

{
  onTransform(({root}) => {
    for (const heading of selectAll('heading', root)) {
      heading.data ??= {}
      heading.data.style ??= {}
      heading.data.style.keepWithNext = true
    }
  })
}
```

A transform callback receives the complete mutable root:

```ts
interface TransformContext {
  root: MdastRoot
}
```

Transform callbacks:

- run after baseline rendering;
- run in registration/source order;
- may mutate the working MDAST;
- may call arbitrary imported TypeScript functions;
- may be async;
- complete before final validation.

## 11.2 `onReady(callback)`

`onReady` is called during render to register a callback for the ready lifetime.

```mdx
import {onReady} from '@markscript/markscript'
import {writeFile} from 'node:fs/promises'
import {serialize} from './serializer.ts'

{
  onReady(async ({root}) => {
    await writeFile('report.out', await serialize(root))
  })
}
```

The ready callback receives a validated, deeply read-only tree:

```ts
interface ReadyContext {
  readonly root: DeepReadonly<MdastRoot>
}
```

Ready callbacks may perform arbitrary ordinary TypeScript work. `run` waits for registered async callbacks and propagates callback failures as program failures.

## 11.3 Closures and ordinary libraries

Callbacks are ordinary TypeScript closures. They may capture imports and module state:

```mdx
import {onReady} from '@markscript/markscript'
import {publish} from '@acme/publisher'

export const destination = process.env.REPORT_DESTINATION

{
  onReady(({root}) => publish(root, destination))
}
```

MarkScript supplies the stable document lifetime; the imported library owns its own behavior and side effects.

---

# 12. Selection and traversal

MarkScript exposes the document as ordinary MDAST during lifetime callbacks, so standard unist libraries operate on it directly.

For CSS-like structural selection, examples use **`unist-util-select`**. Its selector language and matching semantics are used unchanged:

```mdx
import {onTransform} from '@markscript/markscript'
import {select, selectAll} from 'unist-util-select'

{
  onTransform(({root}) => {
    const title = select('heading[depth=1]', root)
    const links = selectAll('link', root)
  })
}
```

`select(selector, root)` returns the first matching node. `selectAll(selector, root)` returns all matching nodes. Selection is immediate against the explicit tree passed by the callback.

Annotation data is ordinary `node.data`. Code can inspect it with TypeScript or a traversal utility such as `unist-util-visit`:

```mdx
import {onTransform} from '@markscript/markscript'
import {visit} from 'unist-util-visit'

{
  onTransform(({root}) => {
    visit(root, node => {
      if (node.data?.ref?.tags?.includes('internal')) {
        node.data.compiler = {
          ...node.data.compiler,
          hidden: true
        }
      }
    })
  })
}
```

This keeps structural selector syntax exactly aligned with `unist-util-select` while arbitrary metadata queries remain ordinary TypeScript.

---

# 13. Compilation and execution model

```text
                 .ms source
                     |
                     v
 GFM + directives + MDX-shaped Markdown/JSX parsing
                     +
          TypeScript/TSX code parsing
                     |
                     v
             ESM program module
                     |
             default entry function
                     |
                  render
                     |
                     v
              baseline MDAST
                     |
          transform callbacks
                     |
                     v
        validation and deep freeze
                     |
                     v
               final MDAST
                     |
             ready callbacks
                     |
                     v
                 mdast.Root
```

Parsing and compilation produce an importable module. Document execution begins when the generated default entry function is invoked, either by application code, a loader configured for eager execution, or `markscript run`.

`markscript run` awaits this entire sequence, including all asynchronous `onReady`
callbacks. After the entry resolves, the CLI adapts the finalized root to its
selected stdout format. Module execution and the programmatic entry ABI end at
the finalized root.

---

# 14. Document entry result

The generated default document entry resolves directly to the validated canonical MDAST root:

```ts
export type MarkScriptEntry = () => Promise<MdastRoot>
```

There is no wrapper result object at the runtime module boundary. Calling a compiled `.ms` module should feel like calling an ordinary imported JavaScript/TypeScript function:

```ts
import runDocument from './document.ms'

const root = await runDocument()
// root: mdast.Root
```

CLI output selection preserves this return type. The default entry and
programmatic run utilities resolve to the root itself; `markscript run` then
serializes or presents it for stdout.

`formatMarkscript(source, options)` is the shared non-executing source
formatter. Its Prettier plugin uses the MarkScript parser and prints directives
as native syntax, preserving literal attribute values and attribute order. It
reuses Prettier for Markdown and embeds TypeScript/TSX formatting for ESM,
expressions, and expression-valued attributes. Fences labeled `ms`, `markscript`,
or `mdx` use the MarkScript formatter; other fenced languages use Prettier's
embedded formatters. Container fences preserve nesting. Leaf and container
directive labels stay on one line even when prose wrapping is enabled.
Prose wrapping preserves the whitespace boundaries around inline syntax.
Markdown escapes and character references retain their text meaning. Expression
comments stay inside their braces, and inline syntax retains its enclosing
Markdown structure. JSX
fragments and block contents retain their document shape. In single-line
contexts, expressions whose formatting requires line breaks retain their source
form. The shared API reparses the result before returning it. The same plugin is
exported as `@markscript/compiler/prettier` for direct
Prettier use with `.ms` files. Project Prettier configuration is
honored when a filename is available. `markscript format FILE` writes formatted
source to stdout, `--write` updates the file, and `--check` exits unsuccessfully
when a change would be required. The language server uses this same API for
whole-document formatting.

Compilation and type-check diagnostics belong to the compiler/bundler boundary. Failures that depend on executing the document, such as an imported library throwing or a transform producing invalid MDAST, propagate as runtime exceptions.

Source-level named exports remain ordinary ESM exports of the compiled module and are independent of the document root.

---

# 15. Importable `.ms` module ABI

Compiling a `.ms` file produces an ESM module whose **default export is an async document entry function**.

Source:

```mdx
export const reportTitle = 'Quarterly report'

export function formatPeriod(year: number, quarter: number) {
  return `${year} Q${quarter}`
}

# Quarterly report

Generated with MarkScript.
```

Application code:

```ts
import runReport, {
  reportTitle,
  formatPeriod
} from './report.ms'

console.log(reportTitle)
console.log(formatPeriod(2026, 3))

const root = await runReport()
consume(root)
```

The module ABI is conceptually:

```ts
export type MarkScriptEntry = () => Promise<MdastRoot>

export default runDocument satisfies MarkScriptEntry
```

The compiler owns the default export as the document entry point. Source-level interoperability uses ordinary named value, function, class, and type exports.

## 15.1 JavaScript/TypeScript interoperability

A compiled `.ms` module interoperates as ordinary ESM. Source-level named exports remain named exports, while MarkScript reserves the generated default export for the document entry function.

```mdx
export const metadata = {
  kind: 'report',
  version: 3
} as const

export function formatTitle(value: string) {
  return value.toUpperCase()
}

export type ReportMetadata = typeof metadata

# Report
```

Application code can import those bindings normally:

```ts
import runReport, {
  metadata,
  formatTitle,
  type ReportMetadata
} from './report.ms'

console.log(metadata.kind)
console.log(formatTitle('report'))

const root = await runReport()
```

Named exports initialize according to normal ESM rules independently of the
document entry. An exported initializer such as
`export const value = compute()` executes during module evaluation, while the
Markdown document body remains deferred until `runReport()` is called.

This makes a `.ms` module behave like a JavaScript/TypeScript module with one additional convention: its default export is the callable document program.

## 15.2 Bundler and loader behavior

The stable compiler ABI is the default entry function. Build-system adapters may configure how imports expose or invoke it.

Recommended modes:

- **callable** — default import is the entry function; application code invokes it explicitly;
- **eager** — an adapter-generated wrapper invokes the entry during module evaluation and exposes the resulting promise/result according to that adapter's module contract.

The callable form is the portable baseline because its ESM type remains stable across runtimes.

`markscript compile` emits the callable module form unless configured otherwise by a loader/adapter.

---

# 16. Dedicated `.ms` language mode

`.ms` is the canonical source extension for standalone MarkScript.

Example:

```mdx
import {onReady} from '@markscript/markscript'
import {writeFile} from 'node:fs/promises'

# Release notes

::ref{id=summary}

Generated at {new Date().toISOString()}.

{
  onReady(async ({root}) => {
    await writeFile('tree.json', JSON.stringify(root, null, 2))
  })
}
```

## 16.1 CLI modes

```sh
markscript check report.ms
markscript compile report.ms -o report.mjs
markscript run report.ms
markscript run report.ms --format mdast
markscript run report.ms -f pretty
markscript help ERR1104
markscript help TUT1001
```

### `check`

Parses the `.ms` source, validates MarkScript structure, and performs static
TypeScript analysis according to project configuration.

### `compile`

Compiles `.ms` into an importable ESM module. The default output exports the callable document entry described in Section 15 and preserves source-level named exports.

### `run`

Runs the compilation step first, reports compiler/type-check diagnostics according to project policy, then loads the compiled module and invokes its default document entry when compilation is allowed to proceed. It executes the complete document lifetime, including registered transform and asynchronous ready callbacks, and waits for the entry to resolve to `mdast.Root` before producing document output.

Markdown is the default output. `--format` / `-f` accepts exactly these public names:

| Format | stdout |
|---|---|
| `markdown` | Raw Markdown serialized from the finalized root |
| `mdast` | Pretty-printed JSON for the finalized MDAST |
| `pretty` | Human-friendly terminal presentation |

These formats are CLI presentations of one finalized root. The programmatic
default entry and run APIs continue to return `mdast.Root`.

The command reserves stdout for the selected document output. MarkScript source
still runs as ordinary TypeScript, and its stdout writes share the document
stream. Source-side logs should use stderr, for example `console.error`, when
clean Markdown or JSON output matters.

### `help`

Looks up the root index, a category index, or a stable `SYN####`, `ERR####`,
`SUG####`, `TUT####`, or `HBK####` code in the compiled manual catalog and
prints the complete document and its canonical `.ms` source link. Programmatic
tools use the importable catalog API directly.

## 16.2 `msdocs` site generation

`@markscript/msdocs` is a small general-purpose static-site library. Its core
accepts a site definition containing navigation and any number of MDAST page
roots; manual-specific behavior is an adapter over that core.

The `msdocs` CLI is:

```sh
msdocs build INPUT [--out-dir site]
msdocs serve INPUT [--host 127.0.0.1] [--port 8000]
```

`INPUT` is required. A `.ms` input executes that trusted MarkScript document
through the normal finalized-root lifetime and builds a one-page site. A
`.ts`, `.mts`, `.js`, or `.mjs` input default-exports a `SiteDefinition` for a
multi-page site. The MarkScript manual supplies its own adapter at
`packages/manuals/msdocs.config.ts`. `serve` builds once and previews the static
output with Bun.

The page shell is a shipped Squirrelly template. CSS, browser JavaScript, and
the 404 response are static files under the package's `public/` directory.
The default MDAST conversion uses an empty rendering for unknown node types and
their children. A `SiteDefinition` can provide standard
`mdast-util-to-hast` options through `mdastToHast`, including per-node handlers
or an `unknownHandler`; those callbacks own the complete output meaning.
The generator owns only files recorded in its output manifest, refuses an
unowned collision, and leaves other files in the output directory untouched.

## 16.3 Compiler API and diagnostics

Programmatic tooling can use compiler utilities without changing the runtime module ABI:

```ts
import {
  check,
  compile
} from '@markscript/compiler'

const diagnostics = await check(source, {
  filename: 'report.ms'
})

const result = await compile(source, {
  filename: 'report.ms'
})

result.code
result.map
result.diagnostics
```

A representative compiler result is:

```ts
interface CompilationResult {
  code: string
  map?: SourceMap
  diagnostics: Diagnostic[]
}
```

Bundler and loader integrations surface these diagnostics through their normal
build diagnostics mechanism. Successful compiled-module invocation returns the
document root.

---

# 17. TypeScript model

## 17.1 Always TypeScript syntax

All code regions inside `.ms` use TypeScript/TSX syntax, including code that contains no explicit type annotations.

This simplifies editor expectations and lets library APIs expose real types.

## 17.2 Configurable type checking

MarkScript takes its type-checking policy from project or standalone configuration. A project may choose:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

or a looser configuration.

The core language requires valid TypeScript syntax, and `markscript check` applies the selected type-checking policy.

## 17.3 JSX types

The runtime publishes TypeScript declarations for:

- Markdown-shaped lowercase intrinsics;
- `attach` and `group` metadata value types;
- component children/value types;
- lifetime callback contexts;
- MDAST root and lifetime callback types;
- MDAST and lifetime callback APIs.

Libraries may export ordinary metadata and helper types alongside their runtime functions.

## 17.4 Parser implementation boundary

Current MDX implementations validate code islands as JavaScript. MarkScript therefore needs an adapter at that parsing/validation boundary so `.ms` code regions are parsed as TypeScript/TSX.

This adapter is a narrow implementation boundary. Markdown and JSX tokenization should remain as close to upstream MDX behavior as practical. The language specification leaves the exact TypeScript-capable parser/transpiler to the implementation.

---

# 18. `data` ownership and library interoperability

MarkScript reserves `node.data` as the common interoperability plane between the language, transforms, and external libraries.

This has several benefits:

- styling and metadata use the standard `data` field;
- annotations survive into downstream unified tooling when desired;
- ordinary libraries can read metadata directly;
- metadata namespaces remain flat and inspectable.

Example:

```js
node.data = {
  ref: {id: 'summary'},
  style: {role: 'lead', indent: 1},
  citation: {key: 'doe-2026'}
}
```

Libraries should treat unfamiliar `data` keys as opaque and preserve them unless their operation explicitly strips metadata.

Here, opaque means that core preserves a library namespace without
interpretation. The final document ownership contract still requires scalar
values, arrays, or plain objects with data properties. Libraries should convert
class instances and other live objects into plain metadata during the mutable
transform lifetime. The separate MDAST tree rule rejects cyclic ancestry and
reused node objects; plain metadata identity remains ordinary data structure.

Core may provide a helper to remove MarkScript metadata when a consumer requires bare MDAST:

```ts
stripData(root)
```

---

# 19. Generic AST mutation

`onTransform` is the primary mechanism for expanding, annotating, or rewriting the complete document after local rendering.

Structural selection and traversal use ordinary unist libraries:

```mdx
import {onTransform} from '@markscript/markscript'
import {visit} from 'unist-util-visit'

{
  onTransform(({root}) => {
    visit(root, node => {
      if (node.data?.ref?.tags?.includes('internal')) {
        node.data ??= {}
        node.data.compiler = {
          ...node.data.compiler,
          hidden: true
        }
      }
    })
  })
}
```

Imported MDAST transforms can operate on the root directly:

```mdx
{
  onTransform(({root}) => {
    normalizeHeadings(root)
    addCrossReferences(root)
  })
}
```

`normalizeHeadings` and `addCrossReferences` are ordinary imported functions operating on MDAST. The compiler validates the resulting tree after all transform callbacks finish.

---

# 20. Package architecture

A deliberately small package split is preferred.

| Package | Responsibility |
|---|---|
| `@markscript/markscript` | Public API and CLI: compile/check/run, document lifetime callbacks, and CLI presentation of finalized roots |
| `@markscript/runtime` | JSX runtime and MarkValue construction |
| `@markscript/compiler` | Public `.ms` parsing, non-executing TypeScript/TSX projection for checking and editor tooling, lowering and validation |
| `@markscript/micromark-extension-mdx-directive` | Fork of `micromark-extension-directive` that tokenizes TypeScript/TSX directive attribute expressions and spreads |
| `@markscript/mdast-util-mdx-directive` | Fork of `mdast-util-directive` that preserves ordered string, boolean, expression, and spread attributes in MDAST |
| `@markscript/remark-mdx-directive` | Fork of `remark-directive` that composes the MarkScript micromark and MDAST directive extensions |
| `@markscript/language-core` | Volar language plugin and virtual-code adapter over the compiler's canonical `.ms` TypeScript projection |
| `@markscript/manuals` | Categorized, numbered `.ms` diagnostic, tutorial, and handbook pages with virtual indexes and an import-time MDAST catalog |
| `@markscript/language-server` | Volar language server with non-executing diagnostics, semantic tokens, TypeScript and Markdown language services, and MarkScript-specific syntax services |
| `markscript-vscode` | VS Code language registration, mixed Markdown/TypeScript/MDX syntax grammar, and Volar LSP client for MarkScript, JavaScript, and TypeScript projects |
| `@markscript/msdocs` | General static-site generation from MarkScript or MDAST site definitions |
| `@markscript/loader-*` | Optional bundler/build-system adapters |

The three directive forks maintain annotated JavaScript implementations and
TypeScript public entrypoints under `src/`. The micromark fork starts from
upstream development sources, retaining named character constants and parser
assertions. The build generates their `dist/` JavaScript and `types/`
declarations before building the runtime and compiler. The manuals build also
generates its public declarations from the authored TypeScript catalog types
and the catalog exports. Generated output is excluded from Git.

Selection and traversal use ordinary unist packages such as `unist-util-select` and `unist-util-visit`. Additional libraries are ordinary projects/packages built from components, MDAST utilities, lifetime callbacks, loaders, or application code.

The compiler projection is adapted once by `@markscript/language-core` into a
Volar `LanguagePlugin`. Its virtual TypeScript and offset-preserving Markdown
codes carry capability-aware source mappings consumed by Volar language-service
plugins. Supported image assets and editor-only declarations are presented as
Volar TypeScript service scripts. No editor consumer independently translates
compiler projection spans or mutates a TypeScript language-service host.

TypeScript-backed editor responses preserve the full information supplied by
the configured TypeScript project. Hover
uses highlighted TypeScript signatures plus Markdown JSDoc; completion carries
symbol kinds, label details, deprecation, replacement/snippet text, commit
characters, documentation, and project auto-import edits mapped back into the
`.ms` source. Call expressions provide overload and parameter documentation
through signature help. The language-service project includes ordinary
tsconfig source roots for cross-file symbols and auto-import discovery, while
validation remains non-executing and reports only diagnostics relevant to the
requested MarkScript graph.

Project ownership follows Volar and the workspace-selected TypeScript SDK: the nearest enclosing
`tsconfig.json` or `jsconfig.json` owns a file, while a file outside a configured
project uses an inferred standalone project. TypeScript path aliases participate in
`.ms` resolution as well as ordinary module resolution; the resolved target
determines the language even when the alias itself has no `.ms` suffix.
Open-document overlays
apply to imported `.ms`, `.ts`, `.tsx`, `.js`, and `.jsx` sources, so diagnostics and language
features observe unsaved dependency edits. Changes to open dependencies,
watched source files, tsconfig files, package boundaries, and workspace folders
invalidate Volar's project view and refresh affected diagnostics. Compiler
diagnostics are exposed through a Volar diagnostic service with cancellation and
source mapping; editor hosts do not maintain a second validation queue or
diagnostic publisher.

The Volar language server owns the complete editor TypeScript project for
MarkScript, JavaScript, and TypeScript documents. It presents non-executing
`.ms` projections to that project, preserves source-level named export types,
exposes the default export as `() => Promise<mdast.Root>`, and maps definitions,
references, highlights, and rename locations back to authored `.ms` spans. The
VS Code extension does not ship or configure a separate TypeScript server
plugin.

Definition, type definition, document highlights, references, and rename use
the same TypeScript project and compiler projection. Their locations and edits
are mapped back to authored `.ms`, `.ts`, and `.tsx` files. A rename is offered
only when every returned edit can be expressed against authored source;
editor destinations consist exclusively of authored locations. Definition
locations from generated TypeScript declarations follow declaration maps to
their authored source when that source is available.
TypeScript quick fixes and non-interactive refactors follow the same rule: an
action is exposed only when its complete workspace edit maps safely to authored
files. New-file and command-bearing actions remain withheld until the host can
apply their full semantics without generated-code leakage.
Organize Imports is exposed as a source action when every resulting change can
be mapped to the authored top-level ESM region; import edits that touch only
generated runtime imports are discarded. Auto-import and import-path edits use
the same project resolver and source-mapping rule.

Markdown document support is supplied by the upstream Volar Markdown service
over an offset-preserving embedded Markdown document. TypeScript, expression,
and MDX fence ranges are whitespace-masked without changing lines or offsets;
Markdown nested inside component children remains visible to the service.
Support includes links, completion, diagnostics, rename, references,
hierarchical heading symbols, heading and block folding ranges, reference
highlights, and syntax-tree selection ranges.
Selection inside projected code prefers TypeScript smart-selection ranges and
falls back to the Markdown service outside code regions. MarkScript-specific
intrinsics, annotations, component signatures, formatting, and semantic-token
arbitration remain focused service plugins layered beside the upstream Markdown
and TypeScript services.

The compiler diagnostic service owns `.ms` documents and their generated
TypeScript projections. Ordinary JavaScript and TypeScript documents retain
the upstream TypeScript diagnostic provider.

The language server owns highlighting correctness. Its semantic-token provider
combines parser-owned Markdown and MDX
node ranges with TypeScript syntactic and semantic classifications mapped
through the compiler projection. It distinguishes Markdown structure,
expression boundaries, intrinsic tags, attributes, uppercase document macros,
and directive syntax, including Markdown nested inside a component. The VS
Code grammar provides a startup and server-unavailable fallback. The semantic
provider owns nested-language boundaries. The extension enables semantic
highlighting for MarkScript by default and contributes theme-scope fallbacks
for its custom Markdown and MDX token types. Projected TypeScript punctuation
is a separate token class from MarkScript and Markdown delimiters, so brackets
and braces inside expression islands retain TypeScript theme semantics. MDX
tag fences have their own semantic token with a neutral block-punctuation
fallback, separate from generic tag and keyword colors.
Annotation names inherit decorator presentation, macros inherit function
presentation, and ordinary intrinsic names retain tag presentation. Projection
spans map normalized multiline expression content line by line, preserving
TypeScript tooling when Markdown parsing removes common source indentation.

The VS Code client registers MarkScript, JavaScript, and TypeScript documents,
selects the workspace TypeScript SDK, starts and restarts the packaged Volar
language server with a configurable Bun executable, and activates Volar's
auto-insertion, file-reference, project-reload, tsconfig-status, and
TypeScript-version client features. It exposes separate
language-server and command output channels. The server dynamically watches
MarkScript, JavaScript, TypeScript, supported image assets, tsconfig, jsconfig, and package
files. The extension
activates for MarkScript workspaces rather than unrelated TypeScript projects.
Because VS Code does not expose an API that disables its built-in TypeScript
providers, exclusive takeover requires disabling **TypeScript and JavaScript
Language Features** for the workspace; otherwise both provider sets may answer
TypeScript requests. The extension
contributes **Check File**, **Check Workspace**, **Run
File**, **Restart Language Server**, and **Show Language Server Output**.
Check and Run save the active authored document and invoke the CLI bundled with
the extension. Only Run executes the document; activation, diagnostics,
formatting, highlighting, navigation, completion, and checking remain static.

---

# 21. Compilation diagnostics and runtime errors

MarkScript diagnostics are compiler/build output. They are source-oriented and should be emitted by `check`, `compile`, language tooling, or the host bundler/loader.

MarkScript-owned diagnostic codes use three four-digit families:

- `SYN####` for source syntax failures;
- `ERR####` for language, compilation, and runtime errors;
- `SUG####` for non-failing improvement suggestions.

Each code is defined by exactly one human-readable `.ms` man page under the
`diagnostics` category of `@markscript/manuals`. The manuals package compiles
those pages, tutorials, and handbooks with the normal MarkScript toolchain and
parses their MDAST when its compiled catalog is imported. Every manual filename
and code-and-title heading share one fixed identity; the rest of a page is free-form
Markdown and may be an explanation, tutorial, example, or recovery guide.
`Problem` and `Fix` are optional section conventions.
Diagnostic prose lives exclusively in the `.ms` manuals, and unshipped code
names use one canonical identity. Diagnostic output prints the exact emitted
message and document link. Manual selectors are bare page codes; tutorial and
handbook codes use `TUT####` and `HBK####`. Category names select their virtual
indexes, while an empty selector selects the root index. `markscript help`
renders the selected catalog document and links its authored `.ms` page.

Examples:

```text
ERR1101: JSX intrinsic <div> lies outside the Markdown constructor vocabulary.
        Use <>...</> for grouping or define an uppercase component.

ERR1102: attribute `className` is invalid on <h2>.
        Attach metadata with a directive or use a component.

ERR1104: flow node `heading` is invalid in phrasing context.
```

TypeScript parser/checker diagnostics are reported alongside MarkScript diagnostics with source positions mapped back to `.ms`.

Diagnostics belong to the compiler result. After successful compilation, the
runtime contract is `Promise<mdast.Root>`.

Some failures emerge during execution. For example, a transform may dynamically
construct invalid MDAST or an imported library may throw. These are runtime
errors: the entry function rejects or throws with ordinary JavaScript error
semantics and available MarkScript source information.

---

# 22. Security

`markscript run` executes TypeScript/JavaScript and therefore executes arbitrary program side effects.

`markscript run` is trusted execution.

Executing an untrusted document requires a genuine isolation boundary with
explicit capabilities for filesystem, network, imports, time, and memory.
The MarkScript process shares the host process security boundary.

`markscript check` performs static source analysis.

`markscript compile` produces a callable document module.

---

# 23. Determinism and ordering

Within MarkScript-controlled document state:

- source content renders in document order;
- pending directive annotations attach deterministically to the next compatible node;
- `onTransform` callbacks run in registration/source order;
- each transform sees mutations from previous transforms;
- final validation occurs after all transforms;
- `onReady` callbacks run only against the finalized tree;
- the final tree passed to `onReady` is deeply frozen.

External determinism belongs to libraries and the host environment. Network
calls, clocks, random numbers, filesystems, and databases remain ordinary
program concerns.

---

# 24. MDAST compatibility boundary

The central interoperability guarantee is:

```ts
import runDocument from './document.ms'

const root = await runDocument()
root // mdast.Root
```

Downstream code receives ordinary MDAST. MarkScript construction values, component execution, pending annotations, directive groups, lifetime callbacks, and source expressions are resolved before this boundary. Directive syntax contributes `node.data`; it is not installed in the standard Markdown output adapter.

This boundary lets existing unified/remark projects consume MarkScript output
directly.

---

# 25. Reference example

```mdx
import {
  onReady,
  onTransform
} from '@markscript/markscript'
import {writeFile} from 'node:fs/promises'
import {visit} from 'unist-util-visit'
import {serializeMarkdown} from './markdown.ts'

export function Note(
  {children}: {children?: unknown}
) {
  return (
    <blockquote>
      <strong>Note: </strong>
      {children}
    </blockquote>
  )
}

# Report

::ref{id=summary visibility=public}
::style{role=lead}

<Note>
This report was generated from {records.length} records.
</Note>

::ref{status=draft}
## Working notes

Internal material.

{
  onTransform(({root}) => {
    visit(root, node => {
      if (node.data?.ref?.status === 'draft') {
        node.data ??= {}
        node.data.compiler = {
          ...node.data.compiler,
          hidden: true
        }
      }
    })
  })
}

{
  onReady(async ({root}) => {
    await writeFile(
      'report.md',
      serializeMarkdown(root)
    )
  })
}
```

Execution model:

```text
1. Parse `.ms` using the GFM/directive/MDX-shaped frontend plus the TypeScript/TSX code parser.
2. Compile to ESM with a generated default document entry and source named exports.
3. Evaluate the compiled module using normal ESM semantics; imports and module-scope export initializers run at this point.
4. Invoke the default entry, implicitly await document and JSX attribute expressions, and construct the lazy MarkValue graph.
5. Resolve component children and component results depth-first and left-to-right, awaiting each component before starting its next sibling.
6. Attach directive data and flatten directive groups.
7. Lower to baseline MDAST; language-labelled fences remain ordinary code nodes.
8. Run transform callbacks in order.
9. Validate and freeze final MDAST.
10. Run ready callbacks; ordinary libraries may perform any permitted I/O.
11. Return the final `mdast.Root` directly.
```

---

# 26. Testing strategy

## 26.1 JSX/MDAST conformance

For each core intrinsic:

1. construct with TSX;
2. lower to MDAST;
3. serialize to Markdown;
4. parse Markdown back to MDAST;
5. compare semantic structure.

## 26.2 TypeScript fixtures

Test code islands containing:

- type assertions;
- generic calls;
- `satisfies`;
- optional chaining and modern syntax;
- type-only imports/exports where permitted;
- multiple `tsconfig` type-checking profiles.

## 26.3 Directive attachment fixtures

Test:

- multiple directive namespaces;
- merge behavior;
- direct `node.data` shape;
- querying directive metadata with ordinary TypeScript/traversal;
- unknown opaque namespaces;
- metadata preservation through transforms.

## 26.4 Consumer-fence fixtures

Verify:

- fenced bodies remain ordinary `code.value` text during parsing, checking,
  compilation, formatting, source mapping, and editor projection;
- transforms select fences through the ordinary `code.lang` field;
- a preceding directive attaches options under `code.data[code.lang]`;
- replacing a selected fence leaves only the consumer's ordinary MDAST output;
- unselected fences remain ordinary code nodes.

## 26.5 Lifetime callback fixtures

Verify:

- render-time ordinary functions execute normally;
- transforms see the complete baseline tree;
- transforms run in registration order;
- later transforms see earlier mutations;
- invalid transform output is rejected;
- `onReady` sees only the validated final tree;
- arbitrary async I/O functions can be called from `onReady` as ordinary TypeScript functions.

## 26.6 Mode separation

Verify:

- `check` completes through static source analysis;
- `compile` completes through source transformation and bundling;
- `run` executes and awaits the full document lifetime sequence before output;
- Markdown, MDAST JSON, and pretty CLI formats are derived from the same finalized root;
- invoking an imported `.ms` default entry and the programmatic run API produce equivalent MDAST.

---

# 27. Decision summary

MarkScript is defined by these decisions:

```text
.ms source
  = Markdown-first MDX-shaped syntax
  + TypeScript/TSX code

JSX
  = constrained Markdown/MDAST construction DSL

directives
  = generic annotations mapped directly into node.data
  = inline and flow attachers plus trace-free flattened flow groups

consumer fences
  = ordinary code nodes selected by language
  = no core consumer registry, parsing, or dispatch

selection / traversal
  = ordinary unist libraries over concrete MDAST roots

ordinary functions
  = ordinary TypeScript execution and side effects

onTransform(...)
  = callback registered for the mutable transform lifetime

onReady(...)
  = callback registered for the read-only ready lifetime


compiled module
  = default async document entry + source named exports

normal form
  = mdast.Root

markscript run output
  = finalized root after all ready callbacks
  -> markdown (default) | mdast JSON | pretty terminal output
```

The core is defined by this boundary; application behavior composes through ordinary TypeScript libraries.

---

# 28. Feasibility references

- **@mdx-js/mdx** — MDX compiler/evaluator and JSX runtime integration: https://mdxjs.com/packages/mdx/
- **remark-mdx / MDX syntax** — MDX additions for JSX, expressions, and module syntax: https://mdxjs.com/packages/remark-mdx/
- **remark-gfm** — GFM tables, strikethrough, task lists, autolinks, and footnotes: https://github.com/remarkjs/remark-gfm
- **remark-directive** — upstream basis for `@markscript/remark-mdx-directive`: https://github.com/remarkjs/remark-directive
- **mdast-util-directive** — upstream basis for `@markscript/mdast-util-mdx-directive`: https://github.com/syntax-tree/mdast-util-directive
- **micromark-extension-directive** — upstream basis for `@markscript/micromark-extension-mdx-directive`: https://github.com/micromark/micromark-extension-directive
- **micromark-extension-mdxjs-esm** — upstream MDX ESM parsing uses a JavaScript-aware parser boundary: https://github.com/micromark/micromark-extension-mdxjs-esm
- **TypeScript TSConfig** — project-configurable compiler and checking options: https://www.typescriptlang.org/tsconfig/
- **TypeScript `strict`** — TypeScript's configurable strict-checking option family: https://www.typescriptlang.org/tsconfig/strict.html
- **unist-util-select** — CSS-like selection over unist trees: https://unifiedjs.com/explore/package/unist-util-select/
- **MDAST** — Markdown Abstract Syntax Tree specification: https://github.com/syntax-tree/mdast
- **unist** — universal syntax tree model and `data` metadata field: https://github.com/syntax-tree/unist
