# MarkScript agent index

`markscript_design.md` is the product authority. Change the design and
implementation together when a decision changes. Implement unshipped APIs
directly against the current contract.

## Quality Requirements

Write concise, modern code and follow these rules:

1. **Current Contract:** Target the latest requirement directly. Unshipped APIs
   use the current design without compatibility machinery. Do not explain or
   comment indeterminate decisions.
2. **Purposeful Verification:** Verify checksums or hashes when they are part of
   a functional requirement.
3. **Essential Tests:** Cover critical business logic, semantic boundaries,
   edge cases, and costly regressions.
4. **Implementation-Focused Communication:** Describe delivered behavior,
   relevant decisions, and verification evidence in affirmative terms.
5. **Focused Scope:** Keep features within the requested package or layer.
   Update downstream consumers when required to preserve their current
   contract. Request approval for a broader product change.

## Build order

The directive tokenizer, MDAST adapter, and Remark plugin build first from
their `src/` directories. Their generated `dist/` and `types/` directories are
bootstrap inputs for the runtime and compiler.

The dependency order is intentional:

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

Run `bun run build` when a change crosses package boundaries. The runtime and
compiler stay independent of the compiled manual catalog because they bootstrap
the `.ms` compiler used to build it.

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

`check` and `compile` perform static source processing. `run` is trusted code
execution. Preserve that boundary when changing loaders, bundling, diagnostics,
or editor features.

`msdocs build INPUT` and `msdocs serve INPUT` are also trusted execution.
`INPUT` is required and is either one `.ms` page or a JavaScript/TypeScript
module that default-exports a site definition. The manual site uses
`packages/manuals/msdocs.config.ts`. Keep page markup in
`packages/msdocs/public/page.squirrelly` and browser presentation in static
`public/` assets.

`markscript run` awaits the complete lifetime, including async `onReady`
callbacks, before writing the finalized document. Its public format names are
only `markdown`, `mdast`, and `pretty`; Markdown is the default. The
programmatic ABI remains `mdast.Root`. Reserve
stdout for document output, and use stderr for source-side logging when clean
machine output matters.

## Diagnostics

Each MarkScript diagnostic has exactly one human-readable source:
`packages/manuals/manuals/diagnostics/<CODE>.ms`. Its minimum man-page shape is:

```markdown
# ERR1234 — Short title

Any Markdown body: explanation, tutorial, examples, recovery steps, or other
sections useful for this code.
```

Diagnostic codes use `SYN####`, `ERR####`, or `SUG####`; tutorials use
`TUT####`, and handbooks use `HBK####`. Every page filename and H1 share that
identity. The build compiles the `.ms` files into an importable catalog beneath
`packages/manuals/dist/` and parses their MDAST on module import. Only the
identity H1 is structural; the remaining page is free-form and indexed into
ordered content/sections. `Problem` and `Fix` are optional conventions. The
`.ms` sources exclusively own human-readable diagnostic prose. Every emitted
code must have a man page so
`markscript help CODE`, CLI errors, and LSP `codeDescription` links remain
exact.

Allocate numbers by subsystem: `1000–1099` frontend/parsing, `1100–1199`
construction and annotations, `1200–1299` final document invariants,
`1300–1399` lifetimes, `2000–2099` compilation/bundling, and `2100–2199`
CLI/output behavior. Use `SUG` only for non-failing guidance. A new emitted
code and its `.ms` page belong in the same change.

## Verification policy

Prefer tests for semantic boundaries and costly regressions: static-only
check/compile behavior, source mapping, imported `.ms` graphs, lifetime order
and isolation, MDAST ownership/validation, diagnostic source integrity, and
stale asynchronous LSP results. Tests should exercise behavior beyond trivial
exports, static manifest fields, basic option parsing, and direct getters.

Useful commands:

```sh
bun run typecheck
bun test
bun run build
bun run markscript check examples/report.ms
bun run msdocs build packages/manuals/msdocs.config.ts --out-dir /tmp/markscript-manual-site
```
