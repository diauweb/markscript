# HBK1003 — Compiler, module graph, and callable ESM ABI

Unified and remark parse MarkScript's Markdown/MDX-shaped syntax, a
TypeScript-capable Acorn adapter accepts embedded TS/TSX regions, TypeScript
checks and transpiles the generated virtual module, and Bun bundles file-backed
module graphs into callable ESM. Compilation stops before document rendering.

The implementation is in `packages/compiler/src/`. Public compiler exports are
re-exported by `@markscript/markscript` for application use.

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

`filename` defaults to a resolved `document.ms` and should be supplied whenever
relative imports, project discovery, or useful source locations matter.

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

Codes emitted by MarkScript use `SYN####`, `ERR####`, or `SUG####`. TypeScript
codes retain their compiler identity as `TS####`. Locations are one-based
UTF-16 source coordinates and are mapped back from generated TSX to the
original `.ms` source. `formatDiagnostic` creates the concise CLI-style string,
and `hasErrors` checks whether any diagnostic has error severity.

Frontend errors that prevent module generation produce an empty `code` string.
The single-module `compile` API can still return transpiled code alongside
semantic TypeScript errors, so callers must inspect `diagnostics` or call
`hasErrors` before using an artifact. `bundleFile` with checking enabled
withholds its bundle when checking reports an error. `MarkScriptCompilationError`
wraps a run failure caused by compilation and exposes the original structured
`diagnostics` array.

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
| `filename` | Logical or filesystem source path used for diagnostics, imports, and config discovery |
| `compilerOptions` | Programmatic TypeScript option overrides |
| `tsconfig` | Explicit config file/directory; `false` disables discovery; omitted finds the nearest config |
| `sourceOverrides` | Unsaved `.ms` text keyed by source path for editor hosts |
| `sourceMap` | Request a map composed back to `.ms` positions |
| `typeCheck` | For compile/bundle, set false to skip semantic checking |
| `check` | For run, set false to skip the pre-execution check |

`check` always performs TypeScript analysis. The `typeCheck` option applies to
compile and bundle operations; `false` enables their transpile-first workflow.

## TypeScript configuration

With no explicit setting, the checker searches upward from the `.ms` file for
the nearest `tsconfig.json`. Passing a directory uses its `tsconfig.json`;
passing a file uses that file; passing `false` selects the standalone profile.

The standalone profile is strict, targets ES2022, uses ESM with bundler module
resolution, enables the Bun type environment, and configures
`@markscript/runtime` as the JSX import source.

Project options and explicit `compilerOptions` apply. The compiler fixes the
following options to preserve consistent `.ms` semantics:

- ESM and bundler module resolution;
- forced module detection;
- TSX emission through `@markscript/runtime`;
- TypeScript extension imports;
- verbatim module syntax;
- checking emits no files;
- checking disables language-service plugins.

For a file-oriented check, project declaration files are added as ambient
roots. The checker excludes unrelated implementation files that appear only in
the project file list. It filters the inapplicable TypeScript no-input
diagnostic for a `.ms`-only project and reports all other config errors.

## Recursive `.ms` checking

The virtual compiler host recognizes explicit relative imports ending in
`.ms`, recursively parses and generates them, and caches each module after its
first visit. Cyclic imports therefore terminate without repeated generation.

```mdx
import {Section} from './section.ms'

# Report

<Section />
```

Diagnostics from an imported source retain that source's filename and
coordinates, so editor clients publish the error on the source document.

`sourceOverrides` lets a language server supply in-memory text for any open
file in this graph. TypeScript/JavaScript and package imports continue through
TypeScript's normal resolver.

## Frontend generation

`parseMarkscript` in `packages/compiler/src/parser.ts` uses `remark-parse` and
`remark-mdx` with the Svelte Acorn TypeScript plugin. It normalizes standalone
flow JSX and the special `<pre><code>` shape that upstream MDX otherwise wraps
as a paragraph.

`generateModule` in `packages/compiler/src/generate.ts` performs two distinct
jobs:

1. validate source-visible Markdown/JSX contexts and attributes early;
2. emit a virtual TSX module that delegates construction and lifetime handling
   to `@markscript/runtime`.

Its generated shape is conceptually:

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

Generated internal identifiers include a source-derived suffix to avoid
colliding with author bindings. Copied TypeScript regions and generated JSX
calls carry source-span mappings used by checking and source-map composition.
Document expressions and JSX attribute expressions are awaited inside
`renderDocument`; module-scope imports and exports remain unchanged.

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

Importing evaluates ESM dependencies and exported initializers. Calling the
default export starts rendering. Tools can inspect named exports after import
and control when document rendering begins.

MarkScript rejects module-scope `await`. Named exports may define async
functions, and document expressions implicitly await promises returned by
those functions.

## Single-module compile versus graph bundle

`compile` and `compileFile` transpile one generated module and preserve its
imports. They are useful for loaders or hosts that resolve imports themselves.

`bundleFile` handles a file-backed graph:

- it type-checks the reachable relative `.ms` graph first unless disabled;
- it asks Bun to bundle relative `.ms`, `.ts`, and other source modules;
- its internal `.ms` loader compiles every document without evaluating it;
- package imports remain external ESM imports;
- environment-variable substitution is disabled in the build;
- the output is one callable ESM entry targeted at portable Node-style ESM;
- build diagnostics and the optional bundle map are composed back through
  each `.ms` module's generated map.

The CLI `compile` command uses `bundleFile`.

## Source maps

There are two mapping stages.

1. The frontend records identity spans from copied TS/TSX regions in the
   virtual module back to `.ms` offsets.
2. TypeScript and Bun maps are composed through those spans so final positions
   point at `.ms` source.

`packages/compiler/src/source-mapping.ts` maps TypeScript diagnostics and
single-module output. `packages/compiler/src/bundle.ts` composes Bun's bundle
map through every compiled `.ms` map and maps Bun resolution/build messages
back when possible.

Consumers receive the source map as a JSON string in `CompilationResult.map`.
The CLI writes it beside the output and appends the appropriate
`sourceMappingURL` comment.

## Compilation and execution

| Operation | Parses/checks | Bundles | Imports source module | Calls document entry |
|---|---:|---:|---:|---:|
| `check` / `checkFile` | yes | no | no | no |
| `compile` / `compileFile` | yes | no | no | no |
| `bundleFile` | yes unless disabled | yes | no | no |
| `runFile` / `run` | yes unless disabled | loader compiles on demand | yes | yes |

`check`, `checkFile`, `compile`, `compileFile`, and `bundleFile` parse, check,
transpile, or bundle source without importing modules or calling document
entries. `runFile` is trusted code execution: it installs the Bun `.ms` loader,
dynamically imports the entry, checks that the default export is callable,
invokes it, and resolves the finalized root.

With checking disabled, `runFile` remains trusted code execution and runtime
MDAST validation remains enabled.

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

Compilation produces a module. An explicit run or entry call executes it.
