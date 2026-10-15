# HBK1003 — Compiler, module graph, and callable ESM ABI

Unified and remark parse MarkScript Markdown and MDX syntax. An Acorn adapter with TypeScript support accepts embedded TS/TSX regions.
TypeScript checks and transpiles the generated virtual module. Bun bundles filesystem module graphs into callable ESM.
Compilation completes before document rendering.

The implementation is in `packages/compiler/src/`.
`@markscript/markscript` reexports the public compiler API for applications.

## Compilation stages

```text
.ms source
  -> remark-parse + remark-mdx with TypeScript-capable Acorn
  -> normalized Markdown/MDX syntax tree
  -> structural frontend validation
  -> generated virtual .ms.tsx module with source spans
  -> TypeScript createProgram checking, when enabled
  -> TypeScript transpilation
  -> optional Bun graph bundle and composed source map
  -> callable ESM module
```

Calling the resulting module's default export starts the runtime lifecycle:

```text
call default entry
  -> render MarkValue graph
  -> lower baseline MDAST
  -> transform callbacks
  -> validate and freeze
  -> ready callbacks
  -> Promise<mdast.Root>
```

## Documenting module exports

Start a top-level module block with a TSDoc/JSDoc comment followed by the
documented export:

```ms
/**
 * Format a report title.
 * @param title - The title to format.
 */
export function formatTitle(title: string): string {
  return title.trim()
}

# {formatTitle('Report')}
```

The comment and export form one module block. The formatter keeps documentation. The editor uses it for hover and signature help.
Imports can also have preceding documentation. Each comment starts at column one.
Blank lines can separate it from the next import or export.

## Document input

To give a document an input parameter, declare a directly exported `Input` interface or type alias.
The document body receives a local `input` binding:

```ms
export interface Input {
  title: string
}

export function formatTitle(data: Input) {
  return data.title.toUpperCase()
}

# {formatTitle(input)}
```

```ts
import report from './report.ms'

const root = await report({title: 'Annual report'})
```

Each call captures its own input in document expressions and lifetime callbacks.
Exported helpers receive input through explicit parameters or factory closures.
Use a concrete type. To expose a shared type, use `export type Input = ReportInput`.
Files without an input declaration have an entry without parameters. Imported entries expose their parameter types to checks and editors.

Pass data with `runFile('report.ms', {input: {title: 'Annual report'}})`.
Alternatively, give JSON with `markscript run report.ms --input report-input.json`.
The file-based API accepts unknown data. The CLI parses JSON. Documents do their own necessary runtime structure validation.

## Programmatic API

```ts
import {
  bundleFile,
  check,
  checkFile,
  compile,
  compileFile,
  run,
  runFile,
  type CompilationResult,
  type CompilerOptions,
  type Diagnostic,
  type RunOptions
} from '@markscript/markscript'
```

The source-oriented forms are:

```ts
check(source: string | Uint8Array, options?: CompilerOptions)
  : Promise<Diagnostic[]>

compile(source: string | Uint8Array, options?: CompilerOptions)
  : Promise<CompilationResult>
```

`filename` defaults to a resolved `document.ms`.
Give it for relative imports, project discovery, or useful source locations.

The file-oriented forms resolve and read the path themselves:

```ts
checkFile(filename, optionsWithoutFilename)
compileFile(filename, optionsWithoutFilename)
bundleFile(filename, optionsWithoutFilename)
runFile(filename, runOptionsWithoutFilename)
```

`run` is the same function as `runFile`.

## Result and diagnostic shapes

```ts
interface CompilationResult {
  code: string
  map?: string
  diagnostics: Diagnostic[]
}

interface Diagnostic {
  code: string
  severity: 'error' | 'warning'
  source: 'markscript' | 'typescript'
  message: string
  filename?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}
```

MarkScript codes use `SYN####`, `ERR####`, or `SUG####`. TypeScript codes keep their `TS####` identity.
Locations use one-based UTF-16 coordinates. The compiler maps them from generated TSX to original `.ms` source.
`formatDiagnostic` creates the short CLI string. `hasErrors` checks for any diagnostic with error severity.

Frontend errors that prevent module generation make an empty `code` string.
Single-module `compile` can return transpiled code with semantic TypeScript errors.
Before artifact use, examine `diagnostics` or call `hasErrors`.
With checking enabled, `bundleFile` emits no bundle if checks report an error.
`MarkScriptCompilationError` contains a compilation-related run failure and the original structured `diagnostics` array.

## Compiler options

```ts
interface CompilerOptions {
  filename?: string
  compilerOptions?: ts.CompilerOptions
  tsconfig?: string | false
  sourceOverrides?: ReadonlyMap<string, string>
  sourceMap?: boolean
  typeCheck?: boolean
}

interface RunOptions extends CompilerOptions {
  check?: boolean
}
```

| Option | Contract |
|---|---|
| `filename` | Logical or filesystem path for diagnostics, imports, and configuration discovery |
| `compilerOptions` | Programmatic TypeScript option overrides |
| `tsconfig` | Explicit file or directory. `false` disables discovery. Omission selects the nearest configuration |
| `sourceOverrides` | Unsaved `.ms` text with source paths as keys for editor hosts |
| `sourceMap` | Map to `.ms` positions |
| `typeCheck` | `false` omits semantic checks for compile or bundle |
| `check` | `false` omits the check before run |

`check` always does TypeScript analysis. `typeCheck` applies to compile and bundle operations.
Set it to `false` for a workflow that transpiles first.

## TypeScript configuration

Without an explicit setting, the checker searches parent directories from the `.ms` file for the nearest `tsconfig.json`.
A directory path selects its `tsconfig.json`. A file path selects that file.
`false` selects the standalone profile.

The standalone profile uses strict checks, ES2022, and ESM with bundler module resolution.
It includes Bun types and uses `@markscript/runtime` as the JSX import source.

Project options and explicit `compilerOptions` apply. The compiler fixes these options for consistent `.ms` semantics:

- ESM and bundler module resolution.
- Forced module detection.
- TSX emission through `@markscript/runtime`.
- TypeScript extension imports.
- Verbatim module syntax.
- No file emission during checks.
- No language-service plugins during checks.

For file-oriented checks, project declaration files become ambient roots.
The checker excludes unrelated implementation files from the project file list.
It omits the inapplicable TypeScript no-input diagnostic for a `.ms`-only project. It reports all other configuration errors.

## Recursive `.ms` checking

The virtual compiler host recognizes explicit relative imports that end in `.ms`.
It recursively parses and generates them. It caches each module after the first visit.
Cyclic imports thus terminate without repeated generation.

```mdx
import {Section} from './section.ms'

# Report

<Section />
```

Imported source diagnostics keep their source filename and coordinates. Editor clients can thus publish errors on the source document.

`sourceOverrides` lets a language server give in-memory text for any open file in the graph.
TypeScript, JavaScript, and package imports use TypeScript's standard resolver.

## Frontend generation

`parseMarkscript` in `packages/compiler/src/parser.ts` uses `remark-parse` and `remark-mdx` with the Svelte Acorn TypeScript plugin.
It normalizes standalone flow JSX and `<pre><code>`. Upstream MDX otherwise puts that structure in a paragraph.

`generateModule` in `packages/compiler/src/generate.ts` has two functions:

1. Validate source-visible Markdown and JSX contexts and attributes early.
2. Emit a virtual TSX module that delegates construction and lifetime management to `@markscript/runtime`.

The generated module has this structure:

```ts
import {executeDocument} from '@markscript/runtime'
import {Fragment, jsx, jsxs} from '@markscript/runtime/jsx-runtime'

// Source imports and named exports remain at module scope.

async function renderDocument() {
  return jsxs(Fragment, {
    children: [await expressionResult /* generated document values */]
  })
}

async function documentEntry() {
  return executeDocument(renderDocument)
}

export default documentEntry
```

Generated internal identifiers have a suffix from the source to prevent collisions with author bindings.
Copied TypeScript regions and generated JSX calls have source-span maps for checks and source-map composition.
`renderDocument` waits for document expressions and JSX attribute expressions.
Module-scope imports and exports stay unchanged.

## Callable module ABI

Every compiled `.ms` module has one stable convention:

```ts
export type MarkScriptEntry = () => Promise<mdast.Root>
```

The compiler-generated default export satisfies that entry type. Source-level
named exports remain standard ESM bindings.

```mdx
export const metadata = {kind: 'report'} as const

export function formatTitle(value: string) {
  return value.toUpperCase()
}

export type Metadata = typeof metadata

# Report
```

Host code imports the named bindings and calls the default entry:

```ts
import runReport, {
  metadata,
  formatTitle,
  type Metadata
} from './report.mjs'

console.log(metadata.kind)
console.log(formatTitle('report'))

const root = await runReport()
```

An import evaluates ESM dependencies and exported initializers. A call to the default export starts rendering.
Tools can examine named exports after import and control when rendering starts.

MarkScript rejects module-scope `await`. Named exports can define async functions.
Document expressions implicitly wait for promises from those functions.

## Single-module compile versus graph bundle

`compile` and `compileFile` transpile one generated module and keep its imports.
Use them for loaders or hosts with their own import resolution.

`bundleFile` handles a file-backed graph:

- It checks types in the reachable relative `.ms` graph first, unless disabled.
- It asks Bun to bundle relative `.ms`, `.ts`, and other source modules.
- Its `.ms` loader compiles each document without evaluation.
- Package imports stay external ESM imports.
- The build disables environment-variable substitution.
- Output is one callable ESM entry for portable Node-style ESM.
- Build diagnostics and the optional bundle map use each `.ms` module's generated map to identify original source.

The CLI `compile` command uses `bundleFile`.

## Source maps

There are two mapping stages.

1. The frontend records identity spans from copied TS/TSX regions in the virtual module to `.ms` offsets.
2. TypeScript and Bun maps use those spans to point final positions to `.ms` source.

`packages/compiler/src/source-mapping.ts` maps TypeScript diagnostics and single-module output.
`packages/compiler/src/bundle.ts` composes Bun's bundle map through each compiled `.ms` map.
It also maps Bun resolution and build messages where possible.

Consumers receive a JSON source-map string in `CompilationResult.map`.
The CLI writes it beside the output and appends the applicable `sourceMappingURL` comment.

## Compilation and execution

| Operation | Parses/checks | Bundles | Imports source module | Calls document entry |
|---|---:|---:|---:|---:|
| `check` / `checkFile` | yes | no | no | no |
| `compile` / `compileFile` | yes | no | no | no |
| `bundleFile` | yes unless disabled | yes | no | no |
| `runFile` / `run` | yes unless disabled | loader compiles on demand | yes | yes |

`check`, `checkFile`, `compile`, `compileFile`, and `bundleFile` process source without module imports or document entry calls.
`runFile` executes trusted code. It installs the Bun `.ms` loader and dynamically imports the entry.
It checks that the default export is callable. Then it calls the entry and resolves the finalized root.

With checks disabled, `runFile` still executes trusted code and validates runtime MDAST.

## Implementation references

| Concern | Source |
|---|---|
| Parser and MDX/TypeScript adapter | `packages/compiler/src/parser.ts` |
| Virtual module and structural frontend | `packages/compiler/src/generate.ts` |
| TypeScript project and recursive `.ms` host | `packages/compiler/src/checker.ts` |
| Source-oriented API | `packages/compiler/src/compiler.ts` |
| Bun graph bundling | `packages/compiler/src/bundle.ts` |
| Runtime loader and `runFile` | `packages/compiler/src/loader.ts` |
| Diagnostic shape and formatting | `packages/compiler/src/diagnostics.ts` |
| Offset/map composition | `packages/compiler/src/source-mapping.ts` |
| Public types | `packages/compiler/src/types.ts` |

Compilation makes a module. An explicit run or entry call executes it.
