# MarkScript agent index

`markscript_design.md` defines the product contract. When a decision changes,
change the design and implementation together. Implement unshipped APIs
with the current contract.

## Quality Requirements

Write short, clear code. Obey these rules:

1. **Current contract:** Implement the latest requirement. Use the current
   design for unshipped APIs. Add no compatibility code for earlier designs.
   Explain only decisions that the requirements define.
2. **Verification:** Verify checksums or hashes only when a functional
   requirement includes this verification.
3. **Tests:** Include tests for critical business logic, semantic boundaries,
   edge cases, and costly regressions.
4. **Communication:** Describe the delivered behavior, applicable decisions,
   and verification results with affirmative statements.
5. **Scope:** Keep features in the specified package or layer. Update downstream
   consumers as necessary to keep their current contract.
   Get approval before a wider product change.

## Build order

First, build the directive tokenizer, MDAST adapter, and Remark plugin from
their `src/` directories. The runtime and compiler use the generated `dist/`
and `types/` directories as initial build inputs.

Build the dependencies in this order:

```text
@markscript/runtime --------------------> @markscript/docx  (optional leaf)
        |
        v
@markscript/compiler
        |
        +---------------------> @markscript/language-core
        |                                |
        |                                v
        |                       language server / TS plugin
        |
        v
@markscript/manuals  (.ms pages -> generated importable catalog and indexes)
        |
        +------------------+------------------+
        v                                     v
    markscript                               msdocs

language server -----------------------> VS Code extension
```

When a change affects more than one package, run `bun run build`.
The runtime and compiler build the `.ms` compiler that creates the manual catalog.
Thus, neither package depends on the compiled catalog.

## Source map

| Concern | Primary source |
|---|---|
| Language contract | `markscript_design.md` |
| JSX values, lowering, validation, lifetimes | `packages/runtime/src/` |
| MDX-shaped parsing and TS/TSX generation | `packages/compiler/src/parser.ts`, `packages/compiler/src/generate.ts` |
| Type checking and `.ms` graph resolution | `packages/compiler/src/checker.ts` |
| Volar virtual code and shared TypeScript projection | `packages/language-core/src/` |
| Bundled callable ESM and source-map composition | `packages/compiler/src/bundle.ts` |
| Public API, citty CLI, and CLI output presentation | `packages/markscript/src/` |
| DOCX transforms, readable data mapping, and output | `packages/docx/src/` |
| Manual sources and generator | `packages/manuals/manuals/`, `packages/manuals/scripts/build.ts` |
| Static manual/site generation | `packages/msdocs/src/` |
| msdocs page template and browser assets | `packages/msdocs/public/` |
| Volar language services and LSP adapter | `packages/language-server/src/` |
| Volar VS Code client, grammar, and packaging | `packages/vscode-markscript/` |

`check` and `compile` process source code statically. `run` executes trusted code.
Keep this boundary when you change loaders, bundles, diagnostics, or editor features.

`msdocs build INPUT` and `msdocs serve INPUT` also execute trusted code.
`INPUT` must be one `.ms` page or a JavaScript or TypeScript module with a site definition as its default export.
The manual site uses `packages/manuals/msdocs.config.ts`.
Keep page markup in `packages/msdocs/public/page.squirrelly`.
Keep browser presentation in static `public/` assets.

`markscript run` waits for the full lifetime, including async `onReady` callbacks.
Then it writes the finalized document. The public formats are `markdown`, `mdast`, and `pretty`.
Markdown is the default. The programmatic ABI uses `mdast.Root`.

Keep stdout for document output. Use stderr for source logs for clean machine output.

## Diagnostics

Each MarkScript diagnostic has one source of human-readable text:
`packages/manuals/manuals/diagnostics/<CODE>.ms`. Use this minimum man-page structure:

```markdown
# ERR1234 — Short title

Any Markdown body: explanation, tutorial, examples, recovery steps, or other
sections useful for this code.
```

Diagnostic codes use `SYN####`, `ERR####`, or `SUG####`. Tutorials use `TUT####`.
Handbooks use `HBK####`. Each filename and H1 must have the same identity.
The build compiles the `.ms` files into an importable catalog under `packages/manuals/dist/`.
The catalog parses the MDAST when a module imports it.

Only the identity H1 has a required structure. The rest of the page can use any Markdown body.
The catalog indexes its content and sections in order. `Problem` and `Fix` are optional section names.
The `.ms` sources contain all human-readable diagnostic text.
Each emitted code must have a man page for `markscript help CODE`, CLI errors, and LSP `codeDescription` links.

Assign numbers by subsystem:

- `1000–1099`: frontend and parser.
- `1100–1199`: construction and annotations.
- `1200–1299`: final document invariants.
- `1300–1399`: lifetimes.
- `2000–2099`: compilation and bundles.
- `2100–2199`: CLI and output behavior.

Use `SUG` only for guidance that does not report a failure.
Add a new emitted code and its `.ms` page in the same change.

## Verification policy

Use tests for semantic boundaries and costly regressions:

- Static behavior of `check` and `compile`.
- Source maps and imported `.ms` graphs.
- Lifetime order and isolation.
- MDAST ownership and validation.
- Diagnostic source integrity.
- Stale asynchronous LSP results.

Tests must verify behavior beyond simple exports, static manifest fields, basic option parsing, and direct getters.

Write project documents in ASD-STE100 Simplified Technical English, Issue 9.
Use approved vocabulary and consistent software technical nouns and verbs.

Keep instructions within 20 words per sentence. Keep descriptions within 25 words per sentence.
Use active voice and one topic per paragraph. Use a maximum of six sentences per paragraph.

Keep API identifiers, paths, code, and diagnostic identities exact. Example projects keep their own language.

Use these software technical terms with their defined project meanings:

| Terms | Meaning |
|---|---|
| MDAST, AST, node, root, flow, phrasing | Document tree types and content contexts |
| Intrinsic, component, directive, attacher, group | MarkScript source and construction forms |
| Module, ESM, binding, export, input, schema | Module interfaces and typed data contracts |
| Lifetime, callback, transform, ready, frozen root | Document execution phases and values |
| Projection, source map, diagnostic, catalog | Compiler, editor, and manual data |
| Context, generation, thread, ability, native tool | msh execution and model interfaces |
| Parse, compile, transpile, bundle, render, serialize | Software conversion operations |
| Import, export, call, invoke, return, await | Module and function execution operations |
| Resolve, normalize, flatten, validate, dispatch | Software data and execution operations |
| Inspect, report, define, support, enable, disable | Software API, diagnostic, and configuration operations |

Use the last four rows as technical verbs only for the specified software operations.
Use other terms as technical nouns. Keep software verbs in the simple tenses.
API names and code examples use their exact source spelling.

Useful commands:

```sh
bun run typecheck
bun test
bun run build
bun run markscript check examples/report.ms
bun run msdocs build packages/manuals/msdocs.config.ts --out-dir /tmp/markscript-manual-site
```
