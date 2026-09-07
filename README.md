# MarkScript

MarkScript is a Markdown-first document programming language. A `.ms` module
combines Markdown, TypeScript expressions, constrained TSX constructors, and
document-lifetime callbacks, then resolves to an ordinary `mdast.Root`.

This Bun workspace implements
[`markscript_design.md`](./markscript_design.md). Its packages keep
the language bootstrap, manuals, and editor integrations separate:

- `@markscript/runtime` — JSX construction, MDAST lowering and validation,
  directive attachment, transform callbacks, and ready callbacks;
- `@markscript/compiler` — the TypeScript-capable MDX frontend plus
  `check`, `compile`, and `run`;
- `@markscript/manuals` — numbered `.ms` diagnostics, tutorials, and handbooks
  with virtual indexes and an import-time parsed catalog;
- `@markscript/msdocs` — general static-site generation from MarkScript or
  MDAST site modules;
- `@markscript/docx` — optional whole-document transforms and DOCX output over
  finalized, readable MDAST;
- `@markscript/markscript` — the public API and citty CLI;
- `@markscript/language-core` — shared Volar virtual code and TypeScript projection adapter;
- `@markscript/language-server` — Volar TypeScript/Markdown tooling plus non-executing compiler diagnostics;
- `markscript-vscode` — `.ms` language registration, grammar, and Volar client.

## Try it

The npm packages use the `@markscript` scope. With Bun 1.4 or newer:

```sh
bun add @markscript/markscript @markscript/runtime
bunx markscript check document.ms
```

To build and run this repository:

```sh
bun install --frozen-lockfile
bun run build
bun run markscript check examples/report.ms
bun run markscript compile examples/report.ms -o report.mjs
bun run markscript run examples/report.ms
bun run markscript run examples/report.ms --format pretty
bun run markscript help ERR1104
bun run msdocs build examples/report.ms
bun run msdocs serve examples/report.ms
bun run manual
```

`run` executes the complete document lifetime, awaits every `onReady` callback,
and then writes the finalized document to stdout. Markdown is the default.
`--format/-f` selects one of three public formats:

| Format | Output |
|---|---|
| `markdown` | Raw finalized Markdown |
| `mdast` | Pretty-printed MDAST JSON |
| `pretty` | Human-friendly terminal rendering |

The format step belongs to the CLI. Imported `.ms` entries and the
programmatic run API continue to resolve to `mdast.Root`.

For `run`, stdout is reserved for document output. Source code still executes
ordinary JavaScript and can write there, but those writes will interleave with
the selected document format. Send source-side logs to stderr, such as with
`console.error`, when clean machine-readable stdout matters.

## Language example

```mdx
import {onReady, onTransform} from '@markscript/markscript'

export const title = 'Quarterly report'

export function Note({children}: {children?: unknown}) {
  return <blockquote><strong>Note: </strong>{children}</blockquote>
}

# {title}

::ref{id=summary visibility=public}

<Note>Generated with **MarkScript**.</Note>

{
  onTransform(({root}) => {
    root.data = {...root.data, reviewed: true}
  })
}

{
  onReady(({root}) => console.error(`${root.children.length} top-level nodes`))
}
```

Imports and named exports are module-scope TypeScript. The compiler owns the
default export, which is an async document entry returning `mdast.Root`.
Following the MDX-shaped grammar, module blocks use exported declarations such
as `export const value = ...`. Private declarations belong in imported
`.ts`/`.tsx` modules.

## Commands

```text
markscript check FILE.ms
markscript compile FILE.ms [-o FILE.mjs] [--source-map] [--transpile-only]
markscript run FILE.ms [--format markdown|mdast|pretty] [--transpile-only]
markscript help [SELECTOR]
markscript format FILE.ms [--write | --check]
```

The source formatter uses a MarkScript Prettier plugin, shared by the CLI and
language server. To use it directly with Prettier after building:

```sh
bunx prettier --plugin @markscript/compiler/prettier examples/report.ms --check
```

The plugin recognizes directives and preserves quoted attribute values while
formatting TypeScript expressions.

`check`, `compile`, and `run` accept `--project tsconfig.json`. `check` performs
static analysis, `compile` emits callable ESM, and `run` executes trusted
TypeScript/JavaScript, including ordinary imported side effects. `run` waits for
registered `onReady` callbacks before formatting the finalized root.

Compilation parses the Markdown/MDX-shaped surface with unified/remark,
checks and transpiles the generated TSX module with TypeScript, and bundles
`.ms`/`.ts` module graphs with Bun into portable callable ESM.

MarkScript-owned codes use `SYN####`, `ERR####`, and `SUG####`. Every code has
one human-readable source in `packages/manuals/manuals/diagnostics/`; tutorials
and handbooks live beside that category. The build compiles these documents
after the runtime/compiler bootstrap, then tools import the compiled manual
catalog and its root/category indexes. CLI diagnostics print their exact
emitted message, `markscript help CODE`, and a link to the individual `.ms`
page; the page body itself is intentionally free-form. `help` accepts codes,
categories, and selectors such as `TUT1001` and `HBK1003`, rendering the parsed
MDAST for a TTY or serialized Markdown when redirected.

## Documentation sites

`msdocs` is the general-purpose static-site side library. Its programmatic API
accepts multi-page MDAST site definitions. Its CLI always takes an input: a
`.ms` document builds one page, while a `.ts`, `.mts`, `.js`, or `.mjs` module
default-exporting `SiteDefinition` builds a multi-page site:

```sh
bun run msdocs build examples/report.ms --out-dir site
bun run msdocs serve examples/report.ms --port 8000
bun run msdocs build packages/manuals/msdocs.config.ts --out-dir site
```

The MarkScript manual owns that site configuration in the manuals package.
Run `bun run manual` to serve it.

The output is ordinary HTML, CSS, and JavaScript. Page HTML comes from the
Squirrelly template in `packages/msdocs/public/page.squirrelly`; the stylesheet,
navigation script, and 404 page are static files in that same `public/` tree.
`serve` builds once and runs a Bun preview
server. Its default MDAST conversion omits unknown node types, and site modules
can customize conversion with standard `mdast-util-to-hast` options. See
[`packages/msdocs/README.md`](./packages/msdocs/README.md) for the programmatic
API, input forms, and output ownership rules.

## Development

```sh
bun run build
bun run check
bun run biome:fix
```

`check` runs Biome, TypeScript, and the focused behavioral suite. The full
build keeps `@markscript/docx` as a downstream leaf while preserving the
runtime → compiler → manuals bootstrap before the remaining tools and VS Code
extension. See [`AGENTS.md`](./AGENTS.md) for the source index,
generated-file boundaries, manual identity rules, and the policy of testing
semantic risks and costly regressions.

## Publishing

All 11 library packages publish to npmjs as public `@markscript/*` packages.
The VS Code extension is packaged separately. Build and verify the release,
then create tarballs outside the checkout:

```sh
bun install --frozen-lockfile
bun run build
bun run check
bun run --cwd packages/vscode-markscript smoke:lsp
bash scripts/pack.sh /tmp/markscript-packages
```

The **Release packages** GitHub Actions workflow also installs those tarballs
in an isolated consumer and exercises the formatter, checker, bundled output,
document execution, DOCX writer, manual catalog, and site generator. Running
the workflow with `publish` disabled performs release verification.

For the first publication, sign in with `npm login` using an account with
publishing access to the npm `markscript` organization, then publish each
tarball with `npm publish ARCHIVE.tgz --access public`. For subsequent releases,
configure an npm trusted publisher on each package with GitHub owner
`diauweb`, repository `markscript`, and workflow `publish-packages.yml`, then
run **Release packages** with `publish` enabled. The workflow publishes with
provenance and verifies a fresh registry installation. Increment package
versions and their internal version constraints before each new release.
