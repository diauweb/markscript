# MarkScript for VS Code

This extension adds MarkScript language support for `.ms` documents:
parser-driven semantic highlighting for Markdown, TypeScript/TSX modules and
expressions, MDX-shaped tags, nested in-tag Markdown, document macros,
directive attachment and groups, and ordinary fenced consumer languages,
diagnostics and TypeScript-powered completion, hover docs,
signature and parameter help, definitions, type definitions, references,
document highlights, rename, safe code actions, formatting, and semantic
highlighting from the bundled language server. TypeScript completion preserves
signature/type label details, Markdown JSDoc, deprecation, snippets,
replacement ranges, commit characters, and project-local auto-import edits.
Markdown labels, heading fragments, and the document outline are
language-server aware as well, and completion remains available while common
expression and macro-tag edits are temporarily incomplete.
Intrinsic names and attributes, directives, fenced-code languages, and nearest
closing tags are completed alongside project-defined TypeScript components.

The Volar language client owns `.ms`, TypeScript, TSX, JavaScript, and JSX
documents. Ordinary TypeScript and JavaScript files therefore use the same
authored `.ms` module contract without a separate TypeScript server plugin.
Named exports retain their declared types, the default export is
`() => Promise<mdast.Root>`, and navigation, references, and rename map
directly to authored `.ms` spans.

VS Code does not expose an extension API for disabling its built-in TypeScript
providers. For exclusive Volar takeover in a MarkScript workspace, disable the
built-in **TypeScript and JavaScript Language Features** extension for that
workspace. If it remains enabled, VS Code may request overlapping TypeScript
features from both providers.

Semantic tokens from the language server are the highlighting authority. They
combine the parsed MarkScript tree with TypeScript syntactic and semantic
classifications and are enabled for `.ms` files by default. The bundled
TextMate grammar provides only immediate startup and server-unavailable
fallback coloring. TypeScript punctuation is kept separate from MarkScript
delimiters; directive names use decorator semantics, macros use function
semantics, and intrinsic elements use tag semantics. Indented multiline
expression islands remain fully mapped to TypeScript after Markdown indentation
normalization.

The extension launches its packaged server with Bun. If `bun` is absent from
the VS Code extension host's `PATH`, set `markscript.server.runtime` to the Bun
executable. Set `markscript.server.path` only when developing against a custom
server build; relative paths resolve from the first workspace folder and may
use `${workspaceFolder}`.

The packaged server includes the declaration-only MarkScript/Bun type environment needed to validate standalone workspaces. Project-installed packages and tsconfig declarations still take precedence during normal module resolution.

Validation is enabled by default. MarkScript follows Volar and TypeScript project
ownership: files use their nearest `tsconfig.json` or `jsconfig.json`, and files
outside a configured project use an inferred project.

Use **MarkScript: Restart Language Server** after changing either server setting.

The command palette provides **MarkScript: Check File**, **Check Workspace**,
**Run File**, **Restart Language Server**, **Reload Projects**,
**Find File References**, **Open Project Configuration**,
**Select TypeScript Version**, and **Show Language Server Output**. Check and
Run use the CLI bundled with the extension. Run is the only editor workflow
that executes a document; normal analysis and checking are static.

## Development

From this package, run `bun run build`. The build bundles the extension client
as `dist/extension.cjs`, bundles `../language-server/src/server.ts` as
`dist/server.js`, stages its declaration-only fallback under
`dist/node_modules/`, and copies the authored `.ms` pages into `manuals/` for
diagnostic help links.

Run `bun run package:vsix` to rebuild and create an installable
`markscript-vscode-VERSION.vsix`. Packaging uses `.vscodeignore` to include
only the manifest, language configuration, grammar, bundled client/server and
its declaration environment, README, and authored manual pages.

After building, `bun run smoke:lsp` launches the packaged `dist/server.js` and
verifies its real stdio protocol surface: initialization, diagnostics,
completion and rich detail resolution, signature help, Markdown hover,
definitions, references, semantic tokens, Markdown completion, and document
symbols.

`bun run test:extension-host` downloads/caches the official VS Code test build
and verifies activation, diagnostics and dependency/config refresh, language
features, TypeScript-to-MarkScript navigation, formatting, Check Workspace,
and Run File in an actual Extension Development Host.
