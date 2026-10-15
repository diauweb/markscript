# MarkScript
## Design Document

> MarkScript is a document programming language with Markdown and MDX syntax, TypeScript and TSX code, and MDAST as its normal form.

MarkScript keeps standard Markdown readable. It uses TypeScript for computation and JSX for restricted construction of structures that Markdown can represent.
Document lifetime callbacks support transforms across the document and standard program side effects.

The standard source extension is **`.ms`**. The `.md` extension identifies Markdown.

MarkScript supports two environments with equal priority:

1. **Module use:** `.ms` files compile to importable ESM modules with a default document entry function and standard named exports.
2. **Dedicated language use:** `.ms` files execute through the MarkScript compiler, runner, and CLI.

The runtime and programmatic document boundary is small.
Standard TypeScript libraries give format conversion, network access, databases, filesystem output, and other domain behavior.
MarkScript programs or host code import and call these libraries directly.
The CLI can display a finalized root as Markdown, MDAST JSON, or terminal output. This display step keeps the same document boundary.

---

# 1. Motivation

Markdown gives document structure and text. TypeScript gives computation.
MDX defines readable syntax for Markdown, JSX, expressions, and modules in the same source.
MarkScript uses this syntax model and **MDAST** as the resulting document representation.

Use cases include:

- Generated technical documents and reports.
- Reusable document components.
- AST annotation and transformation.
- Documents from data.
- Linting and document processing with compiler operations.
- External renderers and converters in standard libraries.
- Programs that primarily make a document and can also do standard I/O.

A typical `.ms` file contains mostly Markdown:

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

`writeFile` and `serialize` are standard TypeScript or JavaScript functions. The program calls them at a defined point in the document lifetime.

---

# 2. Goals

## 2.1 Primary goals

- Keep the source grammar close to MDX.
- Use **`.ms`** as the standard MarkScript source extension.
- Use **TypeScript/TSX syntax** for all code islands.
- Let the project or CLI configuration select the TypeScript type-checking profile.
- Use MDAST as the standard output and interoperability boundary.
- Use JSX as a restricted constructor DSL for structures that Markdown can represent.
- Let standard TypeScript functions and libraries execute usually.
- Use standard unist selection and traversal libraries directly for AST operations across the document.
- Use directives as generic annotations in `node.data`.
- Keep consumer source in standard code fences with language labels.
- Reserve the full MDAST/unist `data` object for MarkScript and its libraries.
- Keep the runtime document value and programmatic ABI independent of output format and application behavior.
- Give **check**, **compile**, and **run** modes.

## 2.2 Scope boundaries

MarkScript has these boundaries:

- The source language uses the Markdown and TypeScript/TSX syntax in this document.
- Lowercase JSX intrinsics have defined Markdown/MDAST semantics.
- Application side effects use standard TypeScript execution at defined document lifetime points.
- Standard libraries give application-specific format conversion and behavior. The CLI output adapters use finalized MDAST.
- Projects can configure the type-checking policy.
- Round-trip conversion keeps semantic MDAST.
- `run` executes trusted programs unless the host gives an isolation boundary.

---

# 3. Core design principles

## 3.1 MDX-shaped surface, MarkScript semantics

MarkScript uses GFM Markdown extensions, generic directive syntax, and MDX JSX and expression syntax as its source model.

The source model is:

```text
GFM Markdown + generic directives + TypeScript expressions + TSX
                  |
                  v
             MarkScript
                  |
                  v
                MDAST
```

MarkScript gives its own JSX runtime and document lifetime model. It makes MDAST as the document value.

## 3.2 TypeScript is the code language

Code inside `.ms` always uses TypeScript/TSX syntax.
Expression forms include type assertions, generic calls, and `satisfies`.
Type-only module syntax is valid where the surrounding MDX form permits module declarations.

The project type-checking policy determines strictness independently of the syntax.

The language toolchain must:

- Parse and transpile code islands as TypeScript/TSX.
- Give exact type declarations for the runtime and JSX vocabulary.
- Give `markscript check` for type checks.
- Use the host project's `tsconfig.json` for compilation in a project.
- Let standalone configuration select TypeScript compiler options.
- Use the configured TypeScript compiler options for checks.

`run` and `compile` support workflows that transpile first. `check` always does type analysis.

## 3.3 MDAST is the normal form

A completed document returns a standard `mdast.Root`.

After successful materialization, the returned tree contains standard MDAST content nodes. MarkScript metadata uses `node.data` where necessary.

## 3.4 Application effects use standard TypeScript

A JavaScript or TypeScript function executes as a standard function.

```mdx
{console.error('rendering section')}
```

This works because `console.error` executes usually and returns `void`. That value adds no document content.
`console.log` also executes usually. Under `markscript run`, it writes to stdout, which contains document output.
For a clean machine-readable document stream, send source logs to stderr.

The language defines the document lifetime points where standard TypeScript code executes.

## 3.5 Libraries are standard TypeScript modules

Import and call libraries as standard TypeScript modules:

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

The fixed lowercase JSX vocabulary defines the core Markdown constructors.
Reusable document abstractions use standard uppercase TSX components. Directives give open metadata.
Document lifetime semantics belong to the core language contract. Selection and traversal use standard unist libraries.

---

# 4. Thin core boundary

The core contains the capabilities necessary to define the language.

## 4.1 Core responsibilities

1. Source loading for `.ms` and parsing for GFM, directives, and MDX syntax.
2. TypeScript/TSX parsing and transpilation for code islands.
3. MarkScript JSX runtime (`Fragment`, `jsx`, `jsxs`, `jsxDEV`).
4. Directive attachment and group flattening into MDAST `data`.
5. Conversion of Markdown JSX intrinsics to MDAST.
6. Standard code fences with language labels for source that a consumer owns.
7. Document lifetime callbacks: `onTransform` and `onReady`.
8. Final MDAST validation.
9. `compile`, `check`, and `run` APIs and CLI behavior.

## 4.2 Outside core

Standard TypeScript libraries give these functions outside the language core:

- DOCX, PDF, and HTML conversion.
- Filesystem writes.
- Network requests.
- Database access.
- Diagram rendering.
- Citation engines.
- Template systems.
- Application-specific style resolvers.
- Publication systems.

Libraries consume or mutate MDAST through standard imports and function calls.

Output libraries keep common Markdown concepts. They use standard Markdown syntax for these concepts.
In the DOCX library, authored text uses standard Markdown paragraphs.
`::docx{style=ReportBody}` attaches a string value to the next paragraph.
`::docx{options={data}}` attaches a computed value. Use `<p />` for an explicit empty paragraph.

DOCX resolution applies each recognized directive namespace on a node. Explicit `data.docx` values have priority.
Boolean directive options accept bare attributes, boolean expressions, and quoted `true` or `false`.

The published `@markscript/docx` runtime bundles the patched `docx` engine.
It keeps character indentation, line-based paragraph spacing, and custom styles consistent across workspace and installed builds.
Custom styles merge with external styles. The `docx` dependency gives exported option types.

---

# 5. Language surface

MarkScript has five visible source forms. Each form uses the MDX syntax model.

| Form | Meaning |
|---|---|
| GFM Markdown | Static document structure and text, including tables, strikethrough, task lists, autolinks, and footnotes |
| `:name`, `::name`, `:::name` | Inline attacher, flow attacher, and flattened flow group |
| `{ expression }` | TypeScript expression with a return value that can add content |
| `<lowercase>` | Built-in JSX constructor with Markdown semantics |
| `<Uppercase>` | User TypeScript component or compile-time document macro |

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

Directives attach named data with short Markdown syntax:

```mdx
:::callout{#release .warning audience="agent"}
## Release status

Deployment is ready.
:::

::badge{tone=success}

Ready.

The :abbr{title="HyperText Markup Language"}**HTML** specification.
```

The one-colon form is zero-width phrasing data. It attaches to the next emitted phrasing node.
The two-colon form is zero-width flow data. It attaches to the next emitted flow node.
Both forms reject labels (`[]`).

The three-colon form is a flow group. It attaches the group namespace and attributes to each directly emitted child.
Then it flattens those children into the parent. The final MDAST contains no group node, ID, range record, or other group trace.
Nested groups merge their data into the affected nodes.

Directive attributes without inner braces are strings. A bare attribute is `true`.
Inner braces use the same TypeScript/TSX expression grammar as JSX, including nested object literals and ordered spreads:

```tsx
export const shared = {keepWithNext: true}

::layout{spacing={{after: 120}} {...shared}}

## Result
```

Consecutive attachers in the same namespace use a shallow merge. Later properties have priority.
A pending attacher causes an error if its local sequence ends before it finds a target.

---

# 6. Runtime value model

The JSX runtime builds a small internal value graph before MDAST conversion.

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

`MarkComponent` is an internal lazy component invocation. Before MDAST conversion, the runtime resolves component children.
Then it calls components in depth-first, left-to-right order. A component can return `MarkValue`, `void`, or a promise of either.
Each component result resolves completely before the next sibling component starts. This keeps lifecycle registration and source order.

The resolved `MarkValue` graph excludes `Promise`.
Each document expression, JSX attribute expression, and JSX spread expression is an implicit async boundary.
The compiler waits for that expression's result inside the generated document renderer.
The runtime also waits for each direct component result during ordered component resolution before MDAST conversion.

The compiler rejects explicit top-level `await` in module declarations, document expressions, and JSX attribute expressions.
Inside a nested async function, `await` uses standard TypeScript semantics.

Implicit await resolves the direct expression result. Promises inside an array or another construction value stay unresolved.
For an expression that makes an array of promises, use `Promise.all(...)`.
The expression boundary then waits for the combined promise.

For document side effects that must have stable document state, use the lifetime callbacks in Section 11.

## 6.1 Primitive normalization

- `null`, `undefined`, and `false` emit no content.
- Strings and numbers in phrasing context become text nodes.
- Strings and numbers in flow or root context become paragraphs with text.
- The runtime flattens arrays.
- The runtime validates MDAST values before insertion.
- The runtime rejects unresolved promises inside arrays, fragments, resolved component results, or MDAST values.
- The runtime rejects unsupported objects and does not convert them to strings implicitly.
- Standard side effects use standard TypeScript and JavaScript execution semantics.

---

# 7. Markdown-shaped JSX

## 7.1 Core intrinsic vocabulary

The lowercase intrinsic set is small. Each intrinsic has Markdown semantics.

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

The core rejects these forms:

```tsx
<div className="panel">...</div>
<h2 className="red">Heading</h2>
<a href="/x" target="_blank">x</a>
```

The intrinsic vocabulary uses standard Markdown/MDAST meanings.
Each of the three directive constructors must have a directive `name`.
They accept standard directive attributes and children that are valid in the applicable directive content context.

## 7.2 Static typing

MarkScript gives JSX type declarations for supported intrinsic elements and properties.
A TypeScript editor or checker can thus find many invalid tags or attributes before execution.

Runtime validation is also necessary. Documents can transpile without type checks, and values can be dynamic.

## 7.3 Context validation

The lowerer enforces MDAST flow and phrasing constraints. Links and reference links cannot contain another link or reference link.
This rule also applies through emphasis, strong text, strikethrough, and text-directive wrappers.
Validation applies the same rule to external MDAST and the finalized document.

```mdx
This is invalid: {<h2>Nested heading</h2>}
```

This makes a diagnostic because phrasing content excludes flow headings.

---

# 8. Components are the macro system

Uppercase JSX names are standard TypeScript values, usually functions.

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

The function executes during document construction and returns MarkScript document values. Components can be asynchronous.
Child components resolve before the runtime calls their parent component. Sibling components resolve from left to right, without concurrency.

A default entry from another `.ms` file acts as an uppercase JSX component in a MarkScript document.
Its asynchronous entry resolves to an MDAST root. The runtime inserts that root's children into the surrounding flow content.

```mdx
import Appendix from './sections/appendix.ms'

<Appendix />
```

Standard TypeScript components thus give the native language macro system.

Put large algorithms and reusable types in imported `.ts` or `.tsx` modules.

---

# 9. Directive data and consumer fences

## 9.1 Direct mapping into `node.data`

The full `data` object is reserved for MarkScript and libraries that support MarkScript.
A directive name becomes a top-level key. Its attributes become the value for that key:

```md
::ref{id=introduction visibility=public}
::style{role=lead color=accent}

## Introduction
```

This converts to:

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

The conversion uses this rule:

```text
::foo{a=1 b=x}  ->  nextFlowNode.data.foo = {a: '1', b: 'x'}
:foo{a=1 b=x}   ->  nextPhrasingNode.data.foo = {a: '1', b: 'x'}
```

`::foo{a=1 b={value} nested={{enabled: true}}}` maps to `{a: '1', b: value, nested: {enabled: true}}`.
The compiler keeps attribute order. A spread or later named attribute replaces an earlier property, as in a JavaScript object literal.

## 9.2 Group flattening

```md
:::review{audience=internal}
## Result

Paragraph.
:::
```

This attaches `data.review` to the heading and paragraph. They stay direct siblings in their original parent.
The final tree contains no `containerDirective`.

## 9.3 MarkScript and library-owned keys

Code that supports MarkScript can assign semantics to keys in `node.data`.
Core behavior uses documented keys, such as `data.compiler`, for persistent metadata. Standard libraries can use the other keys.

## 9.4 Consumer fences

Source that a consumer owns uses a standard code fence. The consumer name is its language label:

````md
::satori{width=1200 height=630 alt="Release summary"}

```satori
<div style={{display: 'flex'}}>Release</div>
```
````

The finalized node is a standard MDAST `code` node. It contains `lang: 'satori'`, the body in `value`, and options in `data.satori`.
The core does no special parsing, evaluation, slot substitution, or dispatch.
A consumer selects the code node by `type` and `lang`.
It interprets `value` and replaces the node during a standard transform if necessary.

---

# 10. Document lifetime

A MarkScript document passes through stable lifetime states.
The model defines **when the document exists, when code can change it, and when it is final**.
Standard TypeScript libraries control their own tree operations.

## 10.1 Module lifetime

An import of a compiled `.ms` module uses standard ESM semantics.
ESM loads and evaluates dependencies and initializes module-scope declarations.
Side effects from module initialization thus occur at import time.

MarkScript separates **module code** from the **document body**:

- ESM imports and source-level exports stay at module scope.
- Exported value initializers execute during standard ESM module initialization.
- Exported function and class declarations become standard module bindings.
- The compiler puts Markdown, document expressions, TSX document content, and lifetime callback registration in the generated default document entry function.

A TSDoc/JSDoc comment (`/** ... */`) at the start of a top-level line can start a module block.
An `import` or `export` must follow on a later top-level line.
Blank lines and additional documentation comments can separate the comment and declaration.
The comment and declaration form one module block.

The formatter, TypeScript projection, hover, and signature help keep this documentation.
Examples in code fences and comments in Markdown containers keep their Markdown meaning.

```mdx
/**
 * Format a reporting period.
 * @param year - Calendar year.
 * @param quarter - Quarter number.
 */
export function formatPeriod(year: number, quarter: number) {
  return `${year} Q${quarter}`
}

# {formatPeriod(2026, 3)}
```

MarkScript rejects module-scope `await`. Asynchronous module APIs use exported async functions.
Document code returns their promises from expressions. The generated renderer waits for those promises.

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

The compiler makes this structure:

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

Thus:

```ts
import runReport, {reportTitle} from './report.ms'

console.log(reportTitle) // available after normal module initialization

const root = await runReport() // starts document rendering
```

An import executes standard ESM initialization as necessary. A call to the generated default export starts MarkScript document body rendering.

### 10.1.1 Image asset imports

Relative imports of `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, and `.svg` files are standard ESM imports with string values:

```mdx
import cover from './assets/cover.jpeg'

<img src={cover} alt="Report cover" />
```

The default import is a base64 `data:` URL. The file extension determines the media type.
The same rule applies to imports in `.ts` or `.tsx` dependencies of a MarkScript entry.
Bundled callable ESM includes the asset bytes.
Its document result thus works without a source asset beside the output module.
`run` gives the same value and makes the same standard MDAST image URL.

Static checks resolve the asset and type its default export as `string`. They do not read it as executable code.
Missing files cause standard module resolution errors. Language tools use the same resolution rule.
Other file types use standard host module loader semantics. Libraries control network retrieval and dynamic resource resolution.

## 10.2 Render lifetime

The default entry evaluates Markdown content and inline TypeScript expressions to construct the document value graph.
It waits for each document expression and JSX attribute expression.
Then it resolves lazy TSX components in depth-first, left-to-right order.
It waits for each component's direct result before the next sibling starts.
Only a completely resolved synchronous `MarkValue` graph enters MDAST conversion.

```mdx
{console.error('render started')}

{items.map(item => <p>{item.name}</p>)}
```

Standard functions called here execute immediately. Valid MarkScript document values add content.
`void`, `null`, `undefined`, and `false` add no MDAST.

```mdx
{loadSummary()}

{Promise.all(items.map(async item => renderItem(item)))}
```

The first expression implicitly waits for `loadSummary()`.
The second combines promises inside an array. Then the expression boundary waits for the resulting promise.
A bare array of promises is invalid.

The render lifetime ends after full baseline MDAST materialization and lifecycle callback registration.
Sequential component resolution keeps callback registration in source order, including when components wait for asynchronous work.

## 10.3 Transform lifetime

The full baseline MDAST exists and is mutable. Transform callbacks execute in registration order.
Each callback sees changes from earlier callbacks.

After transforms finish, MarkScript validates the tree.

## 10.4 Ready lifetime

The validated document is the standard `mdast.Root`. The runtime deeply freezes it before registered ready callbacks receive it.

Ready callbacks can examine the document, serialize it, write files, send network requests, or call any other standard TypeScript library.
These external operations are standard program behavior outside the MDAST model.

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

Lifetime callbacks let source code register work for later document states.

MarkScript core defines two callbacks: `onTransform(...)` and `onReady(...)`.

## 11.1 `onTransform(callback)`

During render, call `onTransform` to register a callback for the transform lifetime.

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

A transform callback receives the full mutable root:

```ts
interface TransformContext {
  root: MdastRoot
}
```

Transform callbacks:

- Execute after baseline rendering.
- Execute in registration and source order.
- Can change the working MDAST.
- Can call any imported TypeScript function.
- Can be async.
- Complete before final validation.

## 11.2 `onReady(callback)`

During render, call `onReady` to register a callback for the ready lifetime.

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

Ready callbacks can do any standard TypeScript work.
`run` waits for registered async callbacks. It propagates callback failures as program failures.

## 11.3 Closures and standard libraries

Callbacks are standard TypeScript closures. They can capture imports and module state:

```mdx
import {onReady} from '@markscript/markscript'
import {publish} from '@acme/publisher'

export const destination = process.env.REPORT_DESTINATION

{
  onReady(({root}) => publish(root, destination))
}
```

MarkScript gives the stable document lifetime. The imported library controls its behavior and side effects.

---

# 12. Selection and traversal

Lifetime callbacks receive standard MDAST. Standard unist libraries operate on it directly.

Examples use **`unist-util-select`** for CSS-like structural selection. Its selector language and match semantics stay the same:

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

`select(selector, root)` returns the first node that matches. `selectAll(selector, root)` returns all nodes that match.
Selection operates immediately on the explicit tree from the callback.

Annotation data is standard `node.data`. Code can examine it with TypeScript or a traversal utility such as `unist-util-visit`:

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

Structural selector syntax stays the same as `unist-util-select`. Queries for other metadata use standard TypeScript.

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

Parsing and compilation make an importable module.
Document execution starts when application code, an eager loader, or `markscript run` calls the generated default entry.

`markscript run` waits for the full sequence, including all asynchronous `onReady` callbacks.
After the entry resolves, the CLI converts the finalized root to the selected stdout format.
Module execution and the programmatic entry ABI return the finalized root.

---

# 14. Document entry result

The generated default document entry resolves directly to the validated standard MDAST root:

```ts
export type MarkScriptEntry = () => Promise<MdastRoot>
```

The runtime module boundary returns the root directly.
Call a compiled `.ms` module as a standard imported JavaScript or TypeScript function:

```ts
import runDocument from './document.ms'

const root = await runDocument()
// root: mdast.Root
```

CLI output selection keeps this return type. The default entry and programmatic run utilities resolve to the root.
Then `markscript run` serializes or displays it for stdout.

`formatMarkscript(source, options)` is the shared static source formatter.
Its Prettier plugin uses the MarkScript parser and prints directives as native syntax.
It keeps literal attribute values and attribute order.
It uses Prettier for Markdown and embedded TypeScript/TSX in ESM, expressions, and expression-valued attributes.

Fences with `ms`, `markscript`, or `mdx` labels use the MarkScript formatter. Other code-fence languages use Prettier's embedded formatters.
Container fences keep their nesting. Leaf and container directive labels stay on one line, including with prose wrapping.

Prose wrapping keeps whitespace boundaries around inline syntax. Markdown escapes and character references keep their text meaning.
Expression comments stay inside their braces. Inline syntax keeps its enclosing Markdown structure.
JSX fragments and block contents keep their document structure.
In single-line contexts, expressions keep their source form if line breaks are necessary for the format.

The shared API reparses the result before it returns the source.
The plugin is also exported as `@markscript/compiler/prettier` for direct Prettier use with `.ms` files.
If a filename is available, the formatter uses the project's Prettier configuration.

`markscript format FILE` writes formatted source to stdout. `--write` updates the file.
`--check` exits unsuccessfully if a file change is necessary.
The language server uses the same API for full document format.

Compilation and type-check diagnostics belong to the compiler and bundler boundary.
Execution-dependent failures propagate as runtime exceptions. Examples include imported library exceptions and transforms that make invalid MDAST.

Source-level named exports remain standard ESM exports of the compiled module and are independent of the document root.

---

# 15. Importable `.ms` module ABI

Compilation of a `.ms` file makes an ESM module. Its **default export is an async document entry function**.

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

The module ABI has this structure:

```ts
export type MarkScriptEntry = () => Promise<MdastRoot>

export default runDocument satisfies MarkScriptEntry
```

The compiler gives the default export as the document entry point.
Source-level interoperability uses standard named value, function, class, and type exports.

## 15.1 JavaScript/TypeScript interoperability

A compiled `.ms` module uses standard ESM interoperability. Source-level named exports stay named exports.
MarkScript reserves the generated default export for the document entry function.

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

Application code can import those bindings usually:

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

Named exports initialize with standard ESM rules, independently of the document entry.
An exported initializer such as `export const value = compute()` executes during module evaluation.
The Markdown document body waits until a call to `runReport()`.

A `.ms` module thus acts as a JavaScript or TypeScript module. Its default export is the callable document program.

## 15.2 Bundler and loader behavior

The stable compiler ABI is the default entry function. Build-system adapters can configure how imports expose or call it.

Recommended modes:

- **callable:** The default import is the entry function. Application code calls it explicitly.
- **eager:** An adapter wrapper calls the entry during module evaluation.
  It exposes the resulting promise or result with that adapter's module contract.

The callable form is the portable baseline. Its ESM type stays stable across runtimes.

`markscript compile` emits the callable module form unless a loader or adapter configures another form.

---

# 16. Dedicated `.ms` language mode

Standalone MarkScript uses `.ms` as its standard source extension.

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

`check` parses `.ms` source, validates MarkScript structure, and does static TypeScript analysis with the project configuration.

### `compile`

`compile` compiles `.ms` into an importable ESM module.
The default output exports the callable document entry from Section 15. It keeps source-level named exports.

### `run`

`run` first compiles the source. It reports compiler and type-check diagnostics with the project policy.
If compilation can proceed, it loads the compiled module and calls the default document entry.
It executes the full document lifetime, including registered transform and asynchronous ready callbacks.
It waits for the entry to resolve to `mdast.Root` before it makes document output.

Markdown is the default output. `--format` / `-f` accepts exactly these public names:

| Format | stdout |
|---|---|
| `markdown` | Markdown serialized from the finalized root |
| `mdast` | Finalized MDAST JSON with indentation |
| `pretty` | Document display for a terminal |

These CLI formats display one finalized root. The programmatic default entry and run APIs return `mdast.Root`.

The command uses stdout for the selected document output. MarkScript source executes as standard TypeScript.
Its stdout writes share the document stream.
For clean Markdown or JSON output, send source logs to stderr, for example with `console.error`.

### `help`

`help` finds a root index, category index, or code in the compiled manual catalog.
Codes use `SYN####`, `ERR####`, `SUG####`, `TUT####`, or `HBK####`.
The command prints the full document and its authoritative `.ms` source link.
Programmatic tools use the importable catalog API directly.

## 16.2 `msdocs` site generation

`@markscript/msdocs` is a small static site library.
Its core accepts a site definition with navigation and any number of MDAST page roots.
A manual adapter gives manual-specific behavior.

The `msdocs` CLI is:

```sh
msdocs build INPUT [--out-dir site]
msdocs serve INPUT [--host 127.0.0.1] [--port 8000]
```

`INPUT` is required. A `.ms` input executes a trusted MarkScript document through the standard finalized-root lifetime and builds one page.
A `.ts`, `.mts`, `.js`, or `.mjs` input gives a default `SiteDefinition` export for a site with multiple pages.
The manual adapter is `packages/manuals/msdocs.config.ts`.
`serve` builds once and previews the static output with Bun.

The package includes a Squirrelly page template.
CSS, browser JavaScript, and the 404 response are static files under `public/`.
Default MDAST conversion emits no content for unknown node types or their children.
A `SiteDefinition` can give standard `mdast-util-to-hast` options through `mdastToHast`.
These options include per-node handlers or an `unknownHandler`. The callbacks define the full output meaning.

The generator owns only files in its output manifest.
It rejects collisions with other files and keeps unrelated files in the output directory.

## 16.3 Compiler API and diagnostics

Programmatic tools can use compiler utilities with the same runtime module ABI:

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

A compiler result has this structure:

```ts
interface CompilationResult {
  code: string
  map?: SourceMap
  diagnostics: Diagnostic[]
}
```

Bundler and loader integrations report these diagnostics through their standard build diagnostic mechanisms.
A successful compiled module invocation returns the document root.

---

# 17. TypeScript model

## 17.1 Always TypeScript syntax

All code regions inside `.ms` use TypeScript/TSX syntax, including code that contains no explicit type annotations.

This gives editors consistent syntax and lets library APIs expose exact types.

## 17.2 Configurable type checking

Project or standalone configuration gives the type-checking policy. A project can select:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

A project can also use a less strict configuration.

The core language uses valid TypeScript syntax, and `markscript check` applies the selected type-checking policy.

## 17.3 JSX types

The runtime publishes TypeScript declarations for:

- Lowercase intrinsics with Markdown semantics.
- `attach` and `group` metadata value types.
- Component children and value types.
- Lifetime callback contexts.
- MDAST root and lifetime callback types.
- MDAST and lifetime callback APIs.

Libraries can export standard metadata and helper types with their runtime functions.

## 17.4 Parser implementation boundary

Current MDX implementations validate code islands as JavaScript.
Thus, MarkScript must have an adapter at the parser and validation boundary to parse `.ms` code regions as TypeScript/TSX.

This adapter has a small implementation boundary. Markdown and JSX tokenization stay close to upstream MDX behavior.
The implementation selects the exact TypeScript parser and transpiler.

---

# 18. `data` ownership and library interoperability

MarkScript reserves `node.data` as the shared interoperability boundary for the language, transforms, and external libraries.

This has several benefits:

- Styles and metadata use the standard `data` field.
- Annotations can pass into downstream unified tools.
- Standard libraries can read metadata directly.
- Metadata namespaces stay flat and available for inspection.

Example:

```js
node.data = {
  ref: {id: 'summary'},
  style: {role: 'lead', indent: 1},
  citation: {key: 'doe-2026'}
}
```

Keep unfamiliar `data` keys without interpretation, unless the library operation explicitly removes metadata.

The core keeps a library namespace without interpretation.
Final document ownership permits only scalar values, arrays, or plain objects with data properties.
During the mutable transform lifetime, convert class instances and other live objects to plain metadata.
The separate MDAST tree rule rejects cyclic ancestry and reused node objects.
Plain metadata identity uses standard data structure semantics.

The core can give a helper to remove MarkScript metadata for consumers that use bare MDAST:

```ts
stripData(root)
```

---

# 19. Generic AST mutation

`onTransform` is the primary mechanism to expand, annotate, or change the full document after local rendering.

Structural selection and traversal use standard unist libraries:

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

`normalizeHeadings` and `addCrossReferences` are standard imported MDAST functions.
The compiler validates the resulting tree after all transform callbacks finish.

---

# 20. Package architecture

Use a small set of packages.

| Package | Responsibility |
|---|---|
| `@markscript/markscript` | Public API and CLI: compile, check, run, lifetime callbacks, and display of finalized roots |
| `@markscript/runtime` | JSX runtime and MarkValue construction |
| `@markscript/compiler` | `.ms` parsing, static TypeScript/TSX projection for checks and editors, MDAST conversion, and validation |
| `@markscript/micromark-extension-mdx-directive` | Fork of `micromark-extension-directive` for tokenization of TypeScript/TSX directive attribute expressions and spreads |
| `@markscript/mdast-util-mdx-directive` | Fork of `mdast-util-directive` that keeps ordered string, boolean, expression, and spread attributes in MDAST |
| `@markscript/remark-mdx-directive` | Fork of `remark-directive` that combines the MarkScript micromark and MDAST directive extensions |
| `@markscript/language-core` | Volar language plugin and virtual-code adapter for the compiler's authoritative `.ms` TypeScript projection |
| `@markscript/manuals` | Numbered `.ms` diagnostic, tutorial, and handbook pages, category indexes, and an MDAST catalog parsed on import |
| `@markscript/language-server` | Volar server with static diagnostics, semantic tokens, TypeScript and Markdown services, and MarkScript syntax services |
| `markscript-vscode` | VS Code language registration, Markdown/TypeScript/MDX grammar, and Volar LSP client for MarkScript, JavaScript, and TypeScript projects |
| `@markscript/msdocs` | Static site generation from MarkScript or MDAST site definitions |
| `@markscript/loader-*` | Optional bundler and build-system adapters |

The three directive forks keep annotated JavaScript implementations and TypeScript public entrypoints under `src/`.
The micromark fork uses upstream development sources, with named character constants and parser assertions.
The build generates their `dist/` JavaScript and `types/` declarations before the runtime and compiler build.
The manuals build generates public declarations from the authored TypeScript catalog types and catalog exports.
Git excludes generated output.

Selection and traversal use standard unist packages, such as `unist-util-select` and `unist-util-visit`.
Additional libraries use components, MDAST utilities, lifetime callbacks, loaders, or application code as standard projects or packages.

`@markscript/language-core` adapts the compiler projection into one Volar `LanguagePlugin`.
Virtual TypeScript and Markdown code contain source maps with feature capabilities. The Markdown code keeps source offsets.
Volar language-service plugins use these maps.
Supported image assets and editor-only declarations use Volar TypeScript service scripts.
Editor consumers use this shared adapter for compiler spans and TypeScript language-service integration.

TypeScript editor responses keep the full information from the configured TypeScript project.
Hover uses highlighted TypeScript signatures and Markdown JSDoc.
Completion includes symbol kinds, label details, deprecation, replacement and snippet text, commit characters, documentation, and project auto-import edits.
The projection maps these edits to `.ms` source.
Call expressions give overload and parameter documentation through signature help.

The language-service project includes standard tsconfig source roots for cross-file symbols and auto-import discovery.
Validation processes source statically. It reports only diagnostics for the requested MarkScript graph.

Project ownership uses Volar and the TypeScript SDK selected by the workspace.
The nearest enclosing `tsconfig.json` or `jsconfig.json` owns a file.
A file outside a configured project uses an inferred standalone project.
TypeScript path aliases participate in `.ms` resolution and standard module resolution.
The resolved target determines the language, including aliases without a `.ms` suffix.

Open-document overlays apply to imported `.ms`, `.ts`, `.tsx`, `.js`, and `.jsx` sources.
Thus, diagnostics and language features see unsaved dependency edits.
Changes to open dependencies, watched sources, tsconfig files, package boundaries, or workspace folders invalidate Volar's project view.
The server then updates affected diagnostics.
A Volar diagnostic service gives compiler diagnostics with cancellation and source maps.
Editor hosts use that service for the validation queue and diagnostic publication.

The Volar language server controls the full editor TypeScript project for MarkScript, JavaScript, and TypeScript documents.
It gives static `.ms` projections and keeps source-level named export types.
The default export is `() => Promise<mdast.Root>`.
Definitions, references, highlights, and rename locations map to authored `.ms` source ranges.
The VS Code extension uses this integration directly, without a separate TypeScript server plugin.

Definition, type definition, document highlights, references, and rename use the same TypeScript project and compiler projection.
Locations and edits map to authored `.ms`, `.ts`, and `.tsx` files.
Rename is available only if every returned edit maps to authored source.
Editor destinations contain only authored locations.
Generated TypeScript declaration locations use declaration maps to their authored source when that source is available.

TypeScript quick fixes and non-interactive refactors use the same rule.
An action is available only if its full workspace edit maps safely to authored files.
For new-file and command-bearing actions, the host must apply all semantics without exposure of generated code.

Organize Imports is available if each change maps to the authored top-level ESM region.
The service discards edits that affect only generated runtime imports.
Auto-import and import-path edits use the same project resolver and source-map rule.

The upstream Volar Markdown service uses an embedded Markdown document with the original source offsets.
Whitespace masks TypeScript, expression, and MDX fence ranges without changes to lines or offsets.
Markdown inside component children stays visible to the service.

Support includes links, completion, diagnostics, rename, references, hierarchical heading symbols, heading and block folding ranges, reference highlights, and syntax-tree selection ranges.
Selection in projected code uses TypeScript smart-selection ranges first.
Outside code regions, it uses the Markdown service.
MarkScript plugins give intrinsics, annotations, component signatures, source format, and semantic-token selection beside the upstream services.

The compiler diagnostic service owns `.ms` documents and their generated
TypeScript projections. Standard JavaScript and TypeScript documents keep
the upstream TypeScript diagnostic provider.

The language server gives highlighting.
Its semantic-token provider combines Markdown and MDX parser ranges with TypeScript syntax and semantic classifications through the compiler projection.
It identifies Markdown structure, expression boundaries, intrinsic tags, attributes, uppercase document macros, and directive syntax, including Markdown inside components.
The VS Code grammar gives initial and server-unavailable fallback colors.
The semantic provider controls nested-language boundaries.

The extension enables MarkScript semantic tokens by default. It gives theme-scope fallbacks for custom Markdown and MDX token types.
Projected TypeScript punctuation uses a separate token class from MarkScript and Markdown delimiters.
Thus, brackets and braces inside expression islands keep TypeScript theme semantics.
MDX tag fences use a separate semantic token with a neutral block-punctuation fallback.
This token is separate from generic tag and keyword colors.

Annotation names use decorator presentation. Macros use function presentation. Standard intrinsic names use tag presentation.
Projection spans map normalized multiline expressions line by line.
TypeScript tools thus work when the Markdown parser removes common source indentation.

The VS Code client registers MarkScript, JavaScript, and TypeScript documents.
It selects the workspace TypeScript SDK and starts or restarts the packaged Volar server with a configurable Bun executable.
It activates Volar auto-insertion, file-reference, project-reload, tsconfig-status, and TypeScript-version features.
Separate output channels show language-server output and command output.
The server watches MarkScript, JavaScript, TypeScript, supported image assets, tsconfig, jsconfig, and package files.
The extension activates for MarkScript workspaces.

VS Code gives no API to disable its built-in TypeScript providers.
For exclusive Volar control, disable **TypeScript and JavaScript Language Features** for the workspace.
Otherwise, both sets of providers can answer TypeScript requests.

The extension gives **Check File**, **Check Workspace**, **Run File**, **Restart Language Server**, and **Show Language Server Output**.
Check and Run save the active authored document and call the bundled CLI.
Run executes the document.
Activation, diagnostics, source format, semantic tokens, navigation, completion, and checks process source statically.

---

# 21. Compilation diagnostics and runtime errors

MarkScript diagnostics are compiler or build output with source locations.
`check`, `compile`, language tools, or the host bundler or loader emit them.

MarkScript-owned diagnostic codes use three four-digit families:

- `SYN####`: source syntax failures.
- `ERR####`: language, compilation, and runtime errors.
- `SUG####`: improvement suggestions that do not indicate failure.

Each code has one human-readable `.ms` man page in the `diagnostics` category of `@markscript/manuals`.
The manuals package compiles these pages, tutorials, and handbooks with the standard MarkScript tools.
It parses their MDAST when a module imports the compiled catalog.
Each filename and code-and-title heading have the same fixed identity.
The rest of a page can contain any Markdown explanation, tutorial, example, or recovery guide.
`Problem` and `Fix` are optional section names.

The `.ms` manuals contain all diagnostic text. Unshipped codes use one identity.
Diagnostic output prints the exact emitted message and document link. Manual selectors use bare page codes.
Tutorial and handbook codes use `TUT####` and `HBK####`.

Category names select virtual indexes. An empty selector selects the root index.
`markscript help` displays the selected catalog document and links its authored `.ms` page.

Examples:

```text
ERR1101: JSX intrinsic <div> lies outside the Markdown constructor vocabulary.
        Use <>...</> for grouping or define an uppercase component.

ERR1102: attribute `className` is invalid on <h2>.
        Attach metadata with a directive or use a component.

ERR1104: flow node `heading` is invalid in phrasing context.
```

The compiler reports TypeScript parser and checker diagnostics with MarkScript diagnostics. It maps source positions to `.ms`.

Diagnostics belong to the compiler result. After successful compilation, the
runtime contract is `Promise<mdast.Root>`.

Execution can cause additional failures. A transform can construct invalid MDAST, or an imported library can throw an exception.
For these runtime errors, the entry rejects or throws with standard JavaScript error semantics and available MarkScript source information.

---

# 22. Security

`markscript run` executes TypeScript and JavaScript with any program side effects.

`markscript run` is trusted execution.

An untrusted document must have an isolation boundary with explicit capabilities for filesystem, network, imports, time, and memory.
The MarkScript process shares the host process security boundary.

`markscript check` performs static source analysis.

`markscript compile` makes a callable document module.

---

# 23. Determinism and ordering

Within MarkScript-controlled document state:

- Source content renders in document order.
- Pending directive annotations attach to the next compatible node with a fixed rule.
- `onTransform` callbacks execute in registration and source order.
- Each transform sees changes from earlier transforms.
- Final validation occurs after all transforms.
- `onReady` callbacks receive only the finalized tree.
- The runtime deeply freezes the tree before `onReady`.

Libraries and the host environment control external determinism.
Network calls, clocks, random numbers, filesystems, and databases are standard program concerns.

---

# 24. MDAST compatibility boundary

The central interoperability guarantee is:

```ts
import runDocument from './document.ms'

const root = await runDocument()
root // mdast.Root
```

Downstream code receives standard MDAST.
Construction values, components, pending annotations, directive groups, lifetime callbacks, and source expressions resolve before this boundary.
Directive syntax gives `node.data`. The standard Markdown output adapter does not include directive syntax.

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

1. Construct the intrinsic with TSX.
2. Convert it to MDAST.
3. Serialize it to Markdown.
4. Parse the Markdown into MDAST.
5. Compare the semantic structure.

## 26.2 TypeScript fixtures

Do tests with code islands that contain:

- Type assertions.
- Generic calls.
- `satisfies`.
- Optional chaining and modern syntax.
- Type-only imports and exports where permitted.
- Multiple `tsconfig` type-checking profiles.

## 26.3 Directive attachment fixtures

Do tests for:

- Multiple directive namespaces.
- Merge behavior.
- Direct `node.data` structure.
- Directive metadata queries with standard TypeScript or traversal.
- Unknown namespaces without interpretation.
- Metadata preservation through transforms.

## 26.4 Consumer-fence fixtures

Verify:

- Code-fence bodies stay standard `code.value` text during parsing, checks, compilation, source format, source maps, and editor projection.
- Transforms select code fences through `code.lang`.
- A preceding directive attaches options under `code.data[code.lang]`.
- Replacement of a selected fence leaves only the consumer's standard MDAST output.
- Unselected fences stay standard code nodes.

## 26.5 Lifetime callback fixtures

Verify:

- Standard functions execute usually during render.
- Transforms see the full baseline tree.
- Transforms execute in registration order.
- Later transforms see earlier changes.
- Validation rejects invalid transform output.
- `onReady` sees only the validated final tree.
- `onReady` can call any async I/O function as a standard TypeScript function.

## 26.6 Mode separation

Verify:

- `check` completes through static source analysis.
- `compile` completes through source transformation and bundling.
- `run` executes and waits for the full lifetime before output.
- Markdown, MDAST JSON, and pretty CLI formats use the same finalized root.
- An imported `.ms` default entry and the programmatic run API make equivalent MDAST.

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

This boundary defines the core. Standard TypeScript libraries give application behavior.

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
