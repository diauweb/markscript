# HBK1006 — Agent and developer workflow

The design document defines the product contract, `AGENTS.md` indexes the
workspace, source implements the contract, and `.ms` manuals explain stable
rules.
Generated artifacts are derived build outputs.

When a decision changes, update the design and implementation together.
Unshipped APIs have no migrations, aliases, deprecations, or compatibility
machinery.

## Required references

Read in this order when beginning a non-trivial change:

1. `markscript_design.md` for the language and product contract.
2. `AGENTS.md` for dependency order, implementation locations,
   generated-file rules, diagnostics, and verification policy.
3. The relevant package's public index and implementation files.
4. The relevant handbook or diagnostic page under
   `packages/manuals/manuals/`.
5. Focused tests for the contract being changed.

If prose and source disagree, determine whether the implementation is
incomplete or the product decision changed. Record intentional contract changes
in the design. Make the implementation, manuals, and focused regression tests
agree with that contract.

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

The root `scripts/build.ts` must preserve this order. Runtime and compiler build
before the `.ms` manuals and compile those manual sources, so the compiled
catalog is unavailable to them. The CLI and language server build later and may
import it. The extension bundles the language server and manual sources after
those stages succeed.

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

Begin with the listed source, then trace public re-exports and consumers. Put
shared behavior in the earliest package that defines the contract, and keep
later adapters focused on their interface.

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

Checking and bundling inspect exports through parsing and TypeScript analysis.
Importing the source module during either operation violates the execution
contract. The language server calls the checker and has no runner dependency.
A side-effect-file test through the production loader path verifies these
requirements. Mock interaction tests verify calls and arguments.

`run` executes arbitrary JavaScript and must be described as trusted execution.
Transpile-only mode controls semantic checking. Runtime side effects and final
MDAST validation still occur.

## Change workflow

### 1. Locate the relevant code

Use narrow repository searches before editing:

```sh
rg -n "symbolOrCode" packages markscript_design.md AGENTS.md
rg --files packages/runtime/src packages/compiler/src
```

Trace the public caller, implementation, diagnostics, and build consumer. For
cross-package behavior, record the dependency direction before adding an
import.

### 2. State the invariant

Write down the observable contract in one sentence. Examples:

- check and compile complete without executing source-program side effects;
- all transform callbacks finish before validation and all ready callbacks see a frozen
  root;
- a TypeScript error in an imported `.ms` file is reported on that file;
- `markscript run` writes document output after the entry resolves;
- every emitted MarkScript code has one authored `.ms` page.

Use this sentence to choose the smallest test that exercises the public
contract.

### 3. Edit the defining package first

Implement the behavior in the package that defines the invariant. Update its
direct types at the same time. Then update public re-exports, CLI/LSP adapters,
manuals, and the design wherever the public contract changes.

Runtime and compiler emit stable codes and concise local messages with no
manuals dependency. The CLI and language server add catalog links after the
manuals package is available.

### 4. Verify locally, then across package dependencies

Run the narrowest meaningful command while iterating. When the change crosses
packages or generated outputs, run the ordered root build and full checks.

### 5. Inspect generated changes

Generated files, lockfiles, declarations, bundles, and copied extension assets
may change. Inspect each relevant output. Remove stale renamed artifacts and
preserve unrelated files.

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

`bun run check` runs Biome, TypeScript, and the test suite. Run `bun run build`
when compiled manuals, declarations, package bundles, or extension assets must
be refreshed.

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

Use an explicit, narrow path under `/tmp`. A workspace root or source file is
an invalid output target for these commands.

## Biome and TypeScript

Biome is the single formatter/linter for JavaScript, TypeScript, JSON, and
configuration files covered by `biome.json`.

```sh
bun run biome:check
bun run biome:fix
bun run format
```

The project style uses two-space indentation, an 80-column formatter target,
single quotes, no routine semicolons, bracket spacing disabled, and trailing
commas where valid. Use the formatter for large mechanical changes.

Biome excludes declarations and built distributions. Formatting fixes belong
in the source or generator that produces those files.

The root TypeScript configuration uses strict checking, ES2022, ESM bundler
resolution, exact optional properties, unchecked-index awareness, and the
MarkScript JSX runtime. Package declaration builds extend that configuration.

## Testing policy

Prioritize tests for semantic contracts and regressions that require substantial
investigation or recovery.

High-value targets include:

- check/compile non-execution;
- `.ms` import graph resolution and cycles;
- TypeScript and bundle source mapping back to `.ms`;
- MDAST context, field, single-parent, and deep-freeze invariants;
- annotation attachment and merge order;
- transform/ready sequencing, async waiting, and concurrent isolation;
- CLI output only after ready callbacks;
- full supported MDAST serialization through the public API;
- emitted-code/manual integrity;
- rejection of stale asynchronous LSP results before publication.

Direct getters, static manifest fields, direct re-exports, and basic option
spelling rarely need dedicated tests. Add a test through the public API that
fails when the stated invariant regresses.

Report mock results as unit-level evidence. An integration claim requires an
available integration or runtime path; otherwise report source-contract
validation and identify the untested environment.

## Generated files

The following are outputs:

- package `dist/` bundles;
- package `types/` declarations;
- the compiled catalog beneath `packages/manuals/dist/`;
- copied manual sources and embedded type environment under
  `packages/vscode-markscript/`;
- static sites emitted by `@markscript/msdocs` into the selected output
  directory.

Edit source and build scripts, then rebuild. The build produces compiled manual
JavaScript. When a source is renamed, verify that its stale compiled entry, map,
and copied extension asset disappear.

The manuals build executes repository `.ms` pages after runtime and compiler
are built. Keep those pages deterministic and free of external network, time,
or machine-specific dependencies.

## Diagnostic information for tools

Every MarkScript diagnostic should provide three exact fields:

1. a stable code;
2. the precise emitted message and location/path;
3. a manual command and document link.

```text
ERR1104: flow node produced by <h2> is invalid in phrasing context
Help: markscript help ERR1104
Docs: file:///.../ERR1104.ms
```

Read the exact page before choosing a fix. The page is Markdown for direct
reading and MDAST for structural tools. Each code maps directly to its
canonical page.

When adding a code, add its `.ms` page in the same change. Allocate by subsystem
and place explanation prose in that page. See the diagnostics and manual
authoring handbook for the full workflow.

## Volar language server workflow

The Volar language server adapts the compiler's canonical projection through
`@markscript/language-core` and supplies TypeScript and Markdown editor
features. Compiler `check` remains the diagnostic authority: it receives
unsaved open documents through `sourceOverrides`, groups imported-file
diagnostics by URI, converts one-based compiler positions to zero-based UTF-16
LSP ranges, and attaches manual links through `codeDescription`.

Validation is debounced. Each document URI has a generation counter, and only
the current generation may publish results. Any change to that queue should be
tested with deliberately reordered async completion.

The extension supports these settings:

| Setting | Meaning |
|---|---|
| `markscript.validation.enabled` | Enable parser and TypeScript diagnostics |
| `markscript.server.runtime` | Bun executable used by the VS Code client |
| `markscript.server.path` | Optional custom language-server module |

Volar follows normal TypeScript project ownership using the nearest
`tsconfig.json` or `jsconfig.json`, with inferred projects outside configured
projects. The server dynamically watches `.ms`, TypeScript/JavaScript,
supported image assets, tsconfig, jsconfig, and package files. The extension
build bundles the client and server, embeds the type environment required for
standalone checks, and copies authored manual sources. Verify both the source
package and built extension when changing module resolution or manual URLs.

## Worktree and dependency changes

Treat unrelated changes as user or collaborator work. Inspect the assigned files
before editing, review the assigned diff afterward, and preserve all other
changes.

When adding a dependency:

- prefer the official library that implements the needed syntax or protocol;
- add it to the package that imports it directly;
- refresh `bun.lock` with Bun;
- verify the dependency is bundled or externalized intentionally;
- use the existing MDAST for a small, cohesive implementation when it already
  supports the requirement.

For example, Markdown output uses official MDAST serializer extensions because
the runtime accepts GFM and frontmatter nodes. Terminal help traverses the
catalog's parsed MDAST directly.

## Review checklist

Before handing off a change, answer these questions:

- Does the implementation match `markscript_design.md`?
- Is the dependency direction preserved?
- Could check, compile, LSP, or bundling execute user code now?
- Does the callable default entry still return `Promise<mdast.Root>`?
- Are transform, validation, freeze, ready callbacks, and CLI output still ordered?
- Does every new emitted code have exactly one `.ms` manual?
- Were only canonical source files edited by hand?
- Do named output formats and CLI options match the current design exactly?
- Is there one meaningful regression test for the changed invariant?
- Did Biome, TypeScript, focused tests, and the required build pass?
- Were generated outputs and stale renamed files inspected?
- Were unrelated worktree changes preserved?

Report verification precisely. List source checks, local execution, packaged
extension tests, and each runtime environment that remains untested.

## Repository documentation requirements

Keep repository guidance navigable:

- stable implementation locations in `AGENTS.md`;
- `markscript_design.md` as the product contract;
- small packages with explicit dependency order;
- exact error codes and human Markdown manuals;
- generated artifacts derived from inspectable `.ms` sources;
- non-execution requirements expressed in code and tests;
- source pointers by concern and cohesive modules;
- commands that reproduce verification locally;
- compatibility paths absent from unshipped APIs.

When adding a subsystem, update these references. Document its canonical
source, public API, failure code where appropriate, and stable behavior. Add
regression tests for the semantic contracts listed in the testing policy.
