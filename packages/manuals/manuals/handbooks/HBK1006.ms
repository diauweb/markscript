# HBK1006 — Agent and developer workflow

The design document defines the product contract. `AGENTS.md` indexes the workspace.
Source implements the contract. `.ms` manuals explain stable rules.
Generated artifacts are build outputs.

When a decision changes, update the design and implementation together.
Implement unshipped APIs with the current contract, without migrations, aliases, deprecations, or compatibility code.

## Required references

For a substantial change, read these references in order:

1. `markscript_design.md` for the language and product contract.
2. `AGENTS.md` for dependency order, implementation locations,
   generated-file rules, diagnostics, and verification policy.
3. The applicable package's public index and implementation files.
4. The applicable handbook or diagnostic page under
   `packages/manuals/manuals/`.
5. Focused tests for the contract being changed.

If text and source disagree, identify an incomplete implementation or a changed product decision.
Record intentional contract changes in the design.
Align implementation, manuals, and focused regression tests with that contract.

## Workspace architecture

The packages follow this dependency order:

```text
@markscript/runtime
        |
        v
@markscript/compiler
        |
        v
@markscript/manuals  (.ms pages -> dist catalog)
        |
        +--------------------+--------------------+
        v                    v                    v
    markscript       language server          msdocs
                              |
                              v
                       VS Code extension
```

The root `scripts/build.ts` must keep this order. Runtime and compiler build before the `.ms` manuals and compile those sources.
The compiled catalog is thus unavailable to them. The CLI and language server build later and can import it.
After these stages succeed, the extension bundles the server and manual sources.

## Implementation locations

| Concern | Primary source |
|---|---|
| Language and product contract | `markscript_design.md` |
| MarkValue, JSX types, intrinsics | `packages/runtime/src/types.ts`, `packages/runtime/src/jsx-runtime.ts` |
| Lowering and annotations | `packages/runtime/src/lower.ts`, `packages/runtime/src/annotations.ts` |
| Lifetimes, validation, freezing | `packages/runtime/src/lifecycle.ts`, `validate.ts`, `freeze.ts` |
| MDX/TypeScript frontend | `packages/compiler/src/parser.ts`, `generate.ts` |
| TypeScript and `.ms` graph checking | `packages/compiler/src/checker.ts` |
| Bun bundle and source maps | `packages/compiler/src/bundle.ts`, `source-mapping.ts` |
| Loader and trusted execution | `packages/compiler/src/loader.ts` |
| Public API and CLI | `packages/markscript/src/index.ts`, `cli.ts` |
| CLI MDAST presentation | `packages/markscript/src/document-output.ts` |
| Manual sources and generator | `packages/manuals/manuals/`, `packages/manuals/scripts/build.ts` |
| Manual catalog parsing | `packages/manuals/src/core.ts` |
| Static manual and trusted-page sites | `packages/msdocs/src/` |
| Non-executing editor validation | `packages/language-server/src/` |
| VS Code client, grammar, packaging | `packages/vscode-markscript/` |
| Cross-package build orchestration | `scripts/build.ts` |

Start with the listed source. Then trace public reexports and consumers.
Put shared behavior in the earliest package that defines the contract.
Keep later adapters focused on their interface.

## Execution behavior

Use this matrix for compiler, loader, CLI, manual, and editor changes.

| Path | May evaluate a user's module? | May call the document entry? |
|---|---:|---:|
| `check` | no | no |
| `compile` / `bundleFile` | no | no |
| Language server validation | no | no |
| VS Code diagnostics | no | no |
| Manual build | yes, for trusted repository manual entries | yes, for those trusted entries |
| `run` / `runFile` | yes | yes |

Checks and bundles examine exports through parsing and TypeScript analysis.
A source module import in either operation violates the execution contract.
The language server uses the checker. It has no runner dependency.
A side-effect-file test through the production loader verifies these requirements. Mock interaction tests verify calls and arguments.

`run` executes any JavaScript. Describe it as trusted execution.
Transpile-only mode controls semantic checks. Runtime side effects and final MDAST validation still occur.

## Change workflow

### 1. Locate the applicable code

Before edits, use narrow repository searches:

```sh
rg -n "symbolOrCode" packages markscript_design.md AGENTS.md
rg --files packages/runtime/src packages/compiler/src
```

Trace the public caller, implementation, diagnostics, and build consumer.
For behavior across packages, record the dependency direction before a new import.

### 2. State the invariant

Write down the observable contract in one sentence. Examples:

- Checks and compilation complete without source-program side effects.
- All transforms finish before validation. All ready callbacks see a frozen root.
- A TypeScript error in an imported `.ms` file appears on that file.
- `markscript run` writes document output after entry resolution.
- Each emitted MarkScript code has one authored `.ms` page.

Use the sentence to select the smallest test that exercises the public contract.

### 3. Edit the defining package first

Implement the behavior in the package that defines the invariant. Update its direct types at the same time.
Then update public reexports, CLI and LSP adapters, manuals, and design for public contract changes.

Runtime and compiler emit stable codes and short local messages without a manuals dependency.
The CLI and language server add catalog links after the manuals package is available.

### 4. Verify locally, then across package dependencies

During changes, run the smallest meaningful verification command.
For changes across packages or generated outputs, run the ordered root build and full checks.

### 5. Examine generated changes

Generated files, lockfiles, declarations, bundles, and copied extension assets can change.
Examine each applicable output. Remove stale renamed artifacts. Keep unrelated files.

## Standard commands

From the workspace root:

```sh
bun install
bun run biome:check
bun run typecheck
bun test
bun run build
bun run check
```

`bun run check` runs Biome, TypeScript, and tests.
To update compiled manuals, declarations, package bundles, or extension assets, run `bun run build`.

Product verification commands include:

```sh
bun run markscript check examples/report.ms
bun run markscript compile examples/report.ms -o /tmp/report.mjs
bun run markscript run examples/report.ms
bun run markscript run examples/report.ms -f mdast
bun run markscript help ERR1104
bun run msdocs build packages/manuals/msdocs.config.ts \
  --out-dir /tmp/markscript-site
```

Use an explicit, limited path under `/tmp`.
These commands reject a workspace root or source file as an output target.

## Biome and TypeScript

Biome is the single formatter/linter for JavaScript, TypeScript, JSON, and
configuration files covered by `biome.json`.

```sh
bun run biome:check
bun run biome:fix
bun run format
```

The project uses two-space indentation, an 80-column format target, single quotes, no routine semicolons, no bracket spacing, and valid trailing commas.
Use the formatter for large mechanical changes.

Biome excludes declarations and build distributions.
Put format corrections in their source or generator.

The root TypeScript configuration uses strict checking, ES2022, ESM bundler
resolution, exact optional properties, unchecked-index awareness, and the
MarkScript JSX runtime. Package declaration builds extend that configuration.

## Testing policy

Give priority to semantic contracts and regressions with high investigation or recovery costs.

High-value targets include:

- Static behavior of checks and compilation.
- `.ms` import graph resolution and cycles.
- TypeScript and bundle maps to original `.ms` source.
- MDAST context, field, single-parent, and deep-freeze invariants.
- Annotation attachment and merge order.
- Transform and ready order, async waits, and concurrent isolation.
- CLI output after ready callbacks.
- full supported MDAST serialization through the public API.
- Emitted-code and manual integrity.
- Rejection of stale asynchronous LSP results before publication.

Direct getters, static manifest fields, direct reexports, and basic option spelling rarely have sufficient risk for separate tests.
Add a public API test that fails if the invariant regresses.

Report mock results as unit-test evidence.
Verify integration claims through an actual integration or runtime path.
Otherwise, report source-contract validation and identify the untested environment.

## Generated files

The following are outputs:

- Package `dist/` bundles.
- Package `types/` declarations.
- Compiled catalog under `packages/manuals/dist/`.
- Copied manual sources and embedded type environment under `packages/vscode-markscript/`.
- Static sites from `@markscript/msdocs` in the selected output directory.

Edit source and build scripts. Then rebuild. The build makes compiled manual JavaScript.
After a source rename, verify removal of the stale compiled entry, map, and copied extension asset.

The manuals build executes repository `.ms` pages after runtime and compiler builds.
Keep pages deterministic and free of network, clock, and machine-specific dependencies.

## Diagnostic information for tools

Each MarkScript diagnostic must give three exact fields:

1. A stable code.
2. The exact emitted message and location or path.
3. A manual command and document link.

```text
ERR1104: flow node produced by <h2> is invalid in phrasing context
Help: markscript help ERR1104
Docs: file:///.../ERR1104.ms
```

Read the exact page before a correction. Markdown supports direct reading. MDAST supports structural tools.
Each code maps directly to its page.

Add a code and its `.ms` page in the same change.
Assign the number by subsystem. Put explanations in that page.
Refer to the diagnostics and manual authoring handbook for the full workflow.

## Volar language server workflow

The Volar server adapts the compiler's projection through `@markscript/language-core`.
It gives TypeScript and Markdown editor features.
Compiler `check` gives diagnostics and receives unsaved documents through `sourceOverrides`.
It groups imported-file diagnostics by URI and converts one-based positions to zero-based UTF-16 LSP ranges.
It attaches manual links through `codeDescription`.

Validation uses a debounce delay. Each document URI has a generation counter.
Only the current generation can publish results.
For validation queue changes, verify deliberately reordered asynchronous completion.

The extension supports these settings:

| Setting | Meaning |
|---|---|
| `markscript.validation.enabled` | Enable parser and TypeScript diagnostics |
| `markscript.server.runtime` | Bun executable used by the VS Code client |
| `markscript.server.path` | Optional custom language-server module |

Volar uses the nearest `tsconfig.json` or `jsconfig.json` for TypeScript project ownership. Files outside configured projects use inferred projects.
The server watches `.ms`, TypeScript and JavaScript, image assets, tsconfig, jsconfig, and package files.
The extension build bundles the client and server, embeds standalone type declarations, and copies authored manuals.
For module resolution or manual URL changes, verify the source package and built extension.

## Worktree and dependency changes

Treat unrelated changes as user or collaborator work. Examine assigned files before edits.
Review the assigned diff after edits. Keep all other changes.

When adding a dependency:

- Use the official library for the required syntax or protocol where possible.
- Add it to the package that imports it directly.
- Update `bun.lock` with Bun.
- Verify the selected bundle or external import behavior.
- Use existing MDAST for a small implementation when it supports the requirement.

Markdown output uses official MDAST serializer extensions for the runtime's GFM and frontmatter nodes.
Terminal help traverses the catalog's parsed MDAST directly.

## Review checklist

Before delivery, answer these questions:

- Does the implementation match `markscript_design.md`?
- Is the dependency direction kept?
- Could check, compile, LSP, or bundling execute user code now?
- Does the callable default entry still return `Promise<mdast.Root>`?
- Are transform, validation, freeze, ready callbacks, and CLI output still ordered?
- Does every new emitted code have exactly one `.ms` manual?
- Were only authored source files edited by hand?
- Do named output formats and CLI options match the current design exactly?
- Is there one meaningful regression test for the changed invariant?
- Did Biome, TypeScript, focused tests, and the required build pass?
- Were generated outputs and stale renamed files examined?
- Were unrelated worktree changes kept?

Report verification exactly. List source checks, local execution, packaged extension tests, and each untested runtime environment.

## Repository documentation requirements

Keep these repository references clear:

- Stable implementation locations in `AGENTS.md`.
- Product contract in `markscript_design.md`.
- Small packages with explicit dependency order.
- Exact error codes and human-readable Markdown manuals.
- Generated artifacts from `.ms` sources that readers can examine.
- Static processing requirements in code and tests.
- Source locations by subject and modules with defined scope.
- Commands that reproduce local verification.
- Current contracts for unshipped APIs, without compatibility paths.

For a new subsystem, update these references.
Document its source, public API, applicable failure code, and stable behavior.
Add regression tests for the contracts in the testing policy.