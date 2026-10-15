# MarkScript

MarkScript is a document programming language with Markdown syntax.
A `.ms` module combines Markdown, TypeScript expressions, restricted TSX constructors, and document lifetime callbacks.
The module makes a standard `mdast.Root`.

This Bun workspace implements [`markscript_design.md`](./markscript_design.md).
Separate packages give the initial language build, manuals, and editor integration:

- `@markscript/runtime`: JSX construction, MDAST conversion and validation,
  directive attachment, transform callbacks, and ready callbacks.
- `@markscript/compiler`: MDX frontend with TypeScript support and the
  `check`, `compile`, and `run` operations.
- `@markscript/manuals`: numbered `.ms` diagnostics, tutorials, handbooks, virtual
  indexes, and a catalog that the package parses on import.
- `@markscript/msdocs`: static site generation from MarkScript or MDAST site modules.
- `@markscript/docx`: optional transforms for the full document and DOCX
  output from finalized, readable MDAST.
- `@markscript/markscript`: public API and citty CLI.
- `@markscript/language-core`: shared Volar virtual code and TypeScript projection adapter.
- `@markscript/language-server`: Volar TypeScript and Markdown services, with static compiler diagnostics.
- `markscript-vscode`: `.ms` language registration, grammar, and Volar client.

## Try it

The npm packages use the `@markscript` scope. Use Bun 1.4 or a later version:

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

`run` executes the full document lifetime and waits for each `onReady` callback.
Then it writes the finalized document to stdout. Markdown is the default.
`--format/-f` selects one of three public formats:

| Format | Output |
|---|---|
| `markdown` | Finalized Markdown |
| `mdast` | MDAST JSON with indentation |
| `pretty` | Document display for a terminal |

The CLI controls output format. Imported `.ms` entries and the programmatic run API return `mdast.Root`.

For `run`, stdout contains document output. Source code can also write JavaScript output to stdout.
Those writes mix with the selected document format.
For clean machine-readable stdout, send source logs to stderr with a function such as `console.error`.

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

Imports and named exports are module-scope TypeScript. The compiler gives the default export.
This async document entry returns `mdast.Root`.
The MDX grammar uses exported declarations for module blocks, such as `export const value = ...`.
Put private declarations in imported `.ts` or `.tsx` modules.

## Commands

```text
markscript check FILE.ms
markscript compile FILE.ms [-o FILE.mjs] [--source-map] [--transpile-only]
markscript run FILE.ms [--format markdown|mdast|pretty] [--transpile-only]
markscript help [SELECTOR]
markscript format FILE.ms [--write | --check]
```

The CLI and language server share a MarkScript Prettier plugin for source format.
After the build, use the plugin directly with Prettier:

```sh
bunx prettier --plugin @markscript/compiler/prettier examples/report.ms --check
```

The plugin recognizes directives. It keeps quoted attribute values when it formats TypeScript expressions.

`check`, `compile`, and `run` accept `--project tsconfig.json`.
`check` does static analysis. `compile` emits callable ESM.
`run` executes trusted TypeScript and JavaScript, including side effects from imports.
It waits for registered `onReady` callbacks before it formats the finalized root.

The compiler parses the Markdown and MDX syntax with unified and remark.
TypeScript checks and transpiles the generated TSX module.
Bun bundles the `.ms` and `.ts` module graphs into portable callable ESM.

MarkScript diagnostic codes use `SYN####`, `ERR####`, and `SUG####`.
Each code has one human-readable source in `packages/manuals/manuals/diagnostics/`.
Tutorials and handbooks have adjacent directories.
The build compiles these documents after the initial runtime and compiler build.
Tools then import the compiled manual catalog and its root and category indexes.

CLI diagnostics show the exact emitted message, `markscript help CODE`, and a link to the `.ms` page.
The page body can use any Markdown structure.
`help` accepts codes, categories, and selectors such as `TUT1001` and `HBK1003`.
It displays the parsed MDAST for a TTY. With redirected output, it writes serialized Markdown.

## Documentation sites

`msdocs` is a static site library. Its programmatic API accepts MDAST site definitions with multiple pages.
Each CLI command must have an input. A `.ms` document builds one page.
A `.ts`, `.mts`, `.js`, or `.mjs` module with `SiteDefinition` as its default export builds multiple pages:

```sh
bun run msdocs build examples/report.ms --out-dir site
bun run msdocs serve examples/report.ms --port 8000
bun run msdocs build packages/manuals/msdocs.config.ts --out-dir site
```

The manuals package contains the site configuration. Run `bun run manual` to serve the site.

The output uses standard HTML, CSS, and JavaScript.
Page HTML comes from the Squirrelly template in `packages/msdocs/public/page.squirrelly`.
The stylesheet, navigation script, and 404 page are static files in the same `public/` directory.

`serve` builds once and starts a Bun preview server. The default MDAST conversion omits unknown node types.
Site modules can change conversion with standard `mdast-util-to-hast` options.
Refer to [`packages/msdocs/README.md`](./packages/msdocs/README.md) for the programmatic API, input forms, and output ownership rules.

## Development

```sh
bun run build
bun run check
bun run biome:fix
```

`check` runs Biome, TypeScript, and the behavioral tests.
The full build keeps `@markscript/docx` as a downstream leaf package.
It builds runtime, compiler, and manuals in that order before the other tools and VS Code extension.
Refer to [`AGENTS.md`](./AGENTS.md) for source locations, generated files, manual identities, and the verification policy.

## Publishing

All 11 library packages publish to npmjs as public `@markscript/*` packages.
The VS Code extension has a separate package.
Build the release. Verify the release. Then create tarballs outside the checkout:

```sh
bun install --frozen-lockfile
bun run build
bun run check
bun run --cwd packages/vscode-markscript smoke:lsp
bash scripts/pack.sh /tmp/markscript-packages
```

The **Release packages** GitHub Actions workflow installs these tarballs in an isolated consumer.
It verifies the formatter, checker, bundle output, document execution, DOCX writer, manual catalog, and site generator.
Run the workflow with `publish` disabled for release verification.

For the first publication, sign in with `npm login`.
Use an account with publication access to the npm `markscript` organization.
Publish each tarball with `npm publish ARCHIVE.tgz --access public`.

For later releases, configure an npm trusted publisher on each package.
Use GitHub owner `diauweb`, repository `markscript`, and workflow `publish-packages.yml`.
Run **Release packages** with `publish` enabled.
The workflow publishes with provenance and waits up to 20 minutes for npm availability after publication scans.
Then it verifies a new registry installation.
Before each release, increase package versions and their internal version constraints.