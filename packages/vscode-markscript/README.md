# MarkScript for VS Code

This extension adds MarkScript language support for `.ms` documents.
The bundled language server gives these features:

- Semantic tokens for Markdown, TypeScript and TSX modules and expressions, MDX tags, and Markdown inside tags.
- Support for document macros, directive attachments and groups, and consumer languages in code fences.
- Diagnostics, completion, hover documentation, signature help, and parameter help.
- Definitions, type definitions, references, document highlights, rename, safe code actions, and source format.

TypeScript completion keeps signature and type labels, Markdown JSDoc, deprecation, snippets, replacement ranges, commit characters, and project-local auto-import edits.
The language server also supports Markdown labels, heading fragments, and the document outline.
Completion stays available during common incomplete edits to expressions and macro tags.
It includes intrinsic names and attributes, directives, code-fence languages, the nearest closing tags, and project-defined TypeScript components.

The Volar language client controls `.ms`, TypeScript, TSX, JavaScript, and JSX documents.
TypeScript and JavaScript files use the same authored `.ms` module contract. This integration uses no separate TypeScript server plugin.
Named exports keep their declared types. The default export is `() => Promise<mdast.Root>`.
Navigation, references, and rename map directly to authored `.ms` source ranges.

VS Code gives no extension API to disable its built-in TypeScript providers.
For exclusive Volar control, disable **TypeScript and JavaScript Language Features** for the MarkScript workspace.
If this extension stays enabled, VS Code can request the same TypeScript features from both providers.

The language server gives the semantic tokens. Tokens combine the parsed MarkScript tree with TypeScript syntax and semantic classifications.
The extension enables them for `.ms` files by default.
The TextMate grammar gives initial colors and fallback colors when the server is unavailable.

TypeScript punctuation stays separate from MarkScript delimiters. Directive names use decorator semantics.
Macros use function semantics. Intrinsic elements use tag semantics.
After Markdown indentation normalization, indented multiline expression islands keep their full TypeScript maps.

The extension starts its packaged server with Bun.
If the extension host's `PATH` does not contain `bun`, set `markscript.server.runtime` to the Bun executable.
For a custom server build, set `markscript.server.path`.
Relative paths use the first workspace folder as their base. They can include `${workspaceFolder}`.

The packaged server includes MarkScript and Bun type declarations for standalone workspaces.
Project-installed packages and tsconfig declarations have priority during standard module resolution.

The extension enables validation by default. MarkScript uses Volar and TypeScript project ownership.
Files use their nearest `tsconfig.json` or `jsconfig.json`. Files outside a configured project use an inferred project.

After a change to either server setting, use **MarkScript: Restart Language Server**.

The command palette gives these commands:

- **MarkScript: Check File** and **Check Workspace**.
- **Run File**, **Restart Language Server**, and **Reload Projects**.
- **Find File References** and **Open Project Configuration**.
- **Select TypeScript Version** and **Show Language Server Output**.

Check and Run use the bundled CLI. Run executes a document. Standard analysis and checks process source code statically.

## Development

From this package, run `bun run build`.
The build bundles the extension client as `dist/extension.cjs` and `../language-server/src/server.ts` as `dist/server.js`.
It puts fallback type declarations under `dist/node_modules/`.
It copies authored `.ms` pages into `manuals/` for diagnostic help links.

Run `bun run package:vsix` to rebuild and create `markscript-vscode-VERSION.vsix`.
Packaging uses `.vscodeignore` to select the manifest, language configuration, grammar, bundled client and server, type declarations, README, and manual pages.

After the build, run `bun run smoke:lsp`.
The command starts the packaged `dist/server.js` and verifies its stdio protocol.
Checks include initialization, diagnostics, completion details, signature help, Markdown hover, definitions, references, semantic tokens, Markdown completion, and document symbols.

`bun run test:extension-host` downloads and caches the official VS Code test build.
It verifies activation, diagnostics, dependency and configuration refresh, language features, TypeScript-to-MarkScript navigation, source format, Check Workspace, and Run File.
The checks use an actual Extension Development Host.