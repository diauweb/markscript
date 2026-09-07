# TUT1004 — TypeScript projects, imports, and editor setup

This intermediate tutorial organizes a MarkScript document as a TypeScript
project. It adds shared `.ts` and `.tsx` modules, composes a second `.ms` file,
and configures editor diagnostics.

## Create the project layout

Use separate directories for document sources and shared implementation:

```text
docs/
  report.ms
  sections/
    appendix.ms
src/
  components.tsx
  data.ts
tsconfig.json
```

Markdown-heavy entry files belong in `docs`. Data access, algorithms, and
components shared by several documents belong in ordinary TypeScript modules.

## Configure TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "jsxImportSource": "@markscript/runtime",
    "types": ["bun"]
  },
  "include": ["docs", "src"]
}
```

MarkScript uses the project configuration for strictness, path mappings,
ambient declarations, and module resolution. Without `--project`, the checker
searches from the source file for the nearest `tsconfig.json`.

Pass an explicit configuration when a workspace contains several projects:

```sh
bun run markscript check docs/report.ms --project tsconfig.json
```

## Add shared TypeScript modules

Create `src/data.ts`:

```ts
export interface Metric {
  label: string
  value: number
  unit: string
}

export async function loadMetrics(): Promise<Metric[]> {
  return [
    { label: 'Availability', value: 99.99, unit: '%' },
    { label: 'Latency', value: 42, unit: 'ms' },
  ]
}
```

Create `src/components.tsx`:

```tsx
import type { Metric } from './data.ts'

export interface MetricLineProps {
  metric: Metric
}

export function MetricLine({ metric }: MetricLineProps) {
  return (
    <p>
      <strong>{metric.label}:</strong> {metric.value}
      {metric.unit}
    </p>
  )
}
```

Import both modules from `docs/report.ms`:

```mdx
import { MetricLine } from '../src/components.tsx'
import { loadMetrics } from '../src/data.ts'

export const reportTitle = 'Service report'

# {reportTitle}

{
  loadMetrics().then(metrics =>
    metrics.map(metric => <MetricLine metric={metric} />)
  )
}
```

The document expression awaits `loadMetrics()` and inserts the component
results in array order.

## Define the `.ms` module interface

Named ESM declarations form the source module's public interface:

```mdx
export const metadata = {
  kind: 'report',
  revision: 3
} as const

export function formatPeriod(year: number, quarter: number) {
  return `${year} Q${quarter}`
}

export type ReportMetadata = typeof metadata

# Report
```

The compiler generates an async default export with this effective type:

```ts
type MarkScriptEntry = () => Promise<mdast.Root>
```

Use named exports for `.ms` module bindings. Put private module-level
declarations in imported `.ts` or `.tsx` files. The compiler reserves the
`.ms` default export for the generated document entry.

Module-scope `await` is outside the grammar. Export an async function and call
it from a document expression when the module interface needs asynchronous
work.

## Compose MarkScript modules

Create `docs/sections/appendix.ms`:

```mdx
export const appendixTitle = 'Appendix'

## {appendixTitle}

Measurements use the production sampling window.
```

Import its named binding and generated entry from `docs/report.ms`:

```mdx
import Appendix, { appendixTitle } from './sections/appendix.ms'

# Service report

The final section is the {appendixTitle.toLowerCase()}.

<Appendix />
```

The checker resolves each relative `.ms` import and maps diagnostics to its
source file. The async `Appendix` entry returns a root whose children are
inserted into the surrounding flow content when the component resolves.

## Check and compile the module graph

Check the entry and every relative `.ms` dependency:

```sh
bun run markscript check docs/report.ms --project tsconfig.json
```

Compile a callable ESM artifact and source map:

```sh
mkdir -p build
bun run markscript compile docs/report.ms \
  --project tsconfig.json \
  --source-map \
  --output build/report.mjs
```

Compilation generates and type-checks TSX, bundles file-backed relative source
modules, and maps generated locations to the original `.ms` files. Package
imports remain external ESM imports.

Import the compiled artifact from Bun:

```ts
import renderReport, { reportTitle } from './build/report.mjs'

console.error(`rendering ${reportTitle}`)
const root = await renderReport()
console.log(root.type)
```

Importing the artifact initializes its ESM modules. Calling `renderReport()`
starts document rendering and returns the finalized MDAST root.

## Configure VS Code

The `markscript-vscode` extension supplies `.ms` syntax highlighting,
diagnostics, completion, hover information, navigation, references, semantic
tokens, Markdown link support, and a document outline.

Enable validation in workspace settings:

```json
{
  "markscript.validation.enabled": true
}
```

Editor features follow Volar and TypeScript project ownership: the nearest
`tsconfig.json` or `jsconfig.json` owns the file, while files outside a
configured project use an inferred project.

The extension starts its packaged language server with `bun`. Configure the
runtime when Bun is absent from the extension host's `PATH`:

```json
{
  "markscript.server.runtime": "/absolute/path/to/bun"
}
```

After changing server settings, run **MarkScript: Restart Language Server**
from the command palette.

## Use editor feedback with the CLI

The language server checks unsaved `.ms` documents and follows their relative
`.ms`, TypeScript, and JavaScript dependencies. It refreshes diagnostics after
source, `tsconfig.json`, or `package.json` changes.

Use the CLI to reproduce project diagnostics before compilation:

```sh
bun run markscript check docs/report.ms --project tsconfig.json
```

The editor and `check` analyze source without importing the document modules.
Run the entry separately when its code is ready to execute:

```sh
bun run markscript run docs/report.ms \
  --project tsconfig.json \
  --format pretty
```

## Next

Continue with [Transform callbacks, ready callbacks, and output pipelines](./TUT1005.ms).
