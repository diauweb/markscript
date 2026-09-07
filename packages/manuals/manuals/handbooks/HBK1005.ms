# HBK1005 — Diagnostics and manual authoring

Human-readable `.ms` pages are the canonical MarkScript manual sources. The
manuals build compiles them with the normal MarkScript toolchain, executes
their document entries during the trusted repository build, and indexes the
resulting MDAST.

Readers, editors, the CLI, and agents use the same material. Markdown contains
the prose, and MDAST provides its structured representation.

Manual sources are stored under `packages/manuals/manuals/`. The build and
parser are implemented by `packages/manuals/scripts/build.ts` and
`packages/manuals/src/core.ts`. The `.ms` files are the only authored,
human-readable copies. The build emits importable JavaScript to the package
`dist/` directory.

## Manual categories

| Category | Source layout | Purpose |
|---|---|---|
| Diagnostic man pages | `packages/manuals/manuals/diagnostics/CODE.ms` | Exact help for one emitted diagnostic |
| Handbooks | `packages/manuals/manuals/handbooks/HBK####.ms` | Stable, detailed reference by concern |
| Tutorials | `packages/manuals/manuals/tutorials/TUT####.ms` | Goal-oriented, end-to-end learning material |

Use one document for one subject. Create a separate page when the material
needs a distinct selector or serves a distinct reader task.

## Selectors and indexes

The catalog gives every page and virtual index a stable selector.

| Manual | Selector |
|---|---|
| Root index | empty string; shown by `markscript help` |
| Category index | `diagnostics`, `tutorials`, or `handbooks` |
| Diagnostic page | its code, such as `ERR1104` |
| Tutorial page | its code, such as `TUT1001` |
| Handbook page | its code, such as `HBK1003` |

Selectors are normalized to uppercase for lookup. Links and authored
references use the canonical uppercase code.

## Page identity

Every page has exactly one source file. Its filename is the canonical uppercase
code, and its first node is an H1 containing the same code, an em dash, and a
short title.

```markdown
# ERR1234 — Short title

Any useful Markdown follows.
```

The identity H1 is the only required content structure. Everything after it is
free-form. A body may contain:

- a one-paragraph explanation;
- a troubleshooting decision tree;
- a tutorial;
- multiple valid and invalid examples;
- recovery or migration steps for external user data;
- implementation notes and source links;
- domain-specific sections.

`Problem` and `Fix` are optional conventions for compact error pages. Choose
section names that fit the subject.

## Code prefixes and allocation

Canonical manual codes use a three-letter prefix followed by exactly four
digits.

| Prefix | Meaning |
|---|---|
| `SYN####` | MarkScript syntax parsing failed |
| `ERR####` | A failing language, construction, runtime, compiler, or CLI condition |
| `SUG####` | Non-failing guidance or an improvement opportunity |
| `TUT####` | A goal-oriented tutorial |
| `HBK####` | A reference handbook |

Allocate error numbers by subsystem:

| Range | Subsystem |
|---:|---|
| 1000–1099 | Frontend and parsing |
| 1100–1199 | Construction, JSX context, and annotations |
| 1200–1299 | Final document and MDAST invariants |
| 1300–1399 | Document lifetime |
| 2000–2099 | Compilation and bundling |
| 2100–2199 | CLI and output presentation |

Choose the code from the subsystem that detects and explains the failure. A
TypeScript compiler diagnostic retains its `TS####` code and stays outside the
MarkScript diagnostic code ranges.

An unshipped code has one canonical identity and no aliases, deprecation
records, migration maps, or compatibility lookup paths.

Allocate tutorial and handbook numbers in reading order, starting at 1001.
Keep established numbers stable when adding or reorganizing prose.

## Diagnostic page content

Start with the emitted code, the failed rule, and the phase that detected it.
Provide enough context for the reader to select a correction directly from the
manual.

A diagnostic page should answer the applicable questions:

1. What invariant was violated?
2. At which phase was it detected?
3. Did checking, compilation, or execution occur?
4. What source or MDAST shapes commonly produce it?
5. What evidence in the emitted message or path narrows the case?
6. What changes preserve the intended document semantics?
7. Which nearby APIs or source files define the rule?

Choose section names that describe the content. For example:

````markdown
# ERR1234 — A transform reused one node in two locations

This error is raised during final validation, after every transform has run.

## Read the reported paths

The first path identifies the node's original location. The second path is the
attempted reuse.

## Rebuild reused nodes

```ts
const copy = structuredClone(node)
root.children.push(copy)
```

## When a library returns the node

Request a fresh subtree for each insertion, or clone the returned subtree
before inserting it.
````

## Exact messages and manual prose

Runtime and compiler code contains the concise emitted message. The `.ms` page
contains the explanation, examples, investigation steps, and recovery guidance.
Keep that explanatory prose in the manual page. TypeScript constants contain
concise emitted messages, and generator logic compiles and indexes the pages.

Store the information as follows:

```text
emitter
  -> code, severity, exact local message, source location/path

manual page
  -> concepts, examples, investigation, recovery, related rules
```

The CLI prints the exact message first, followed by `markscript help CODE` and
the individual document URL. The language server preserves the exact code and
adds that URL as LSP `codeDescription`. Both interfaces refer to the same
manual page.

## Adding a new diagnostic

Update the emitter and its manual in the same change.

1. Confirm that the condition is a MarkScript failure that needs a stable code.
   Reuse an existing code for the same condition. Propagated TypeScript and
   user-library exceptions retain their original identities.
2. Choose an unused number in the detecting subsystem's range.
3. Add `packages/manuals/manuals/diagnostics/CODE.ms` with the exact identity
   H1 and a body appropriate to the failure.
4. Emit that exact code from the detecting package and attach the most precise
   filename, source position, MDAST path, and cause available.
5. Update the design document if the failure reflects a new or changed
   language contract.
6. Run the manuals build so the importable catalog matches the sources.
7. Run the source-integrity test that compares emitted codes with authored
   pages.
8. Exercise the actual CLI or LSP interface if the link behavior changed.

Search before allocating:

```sh
rg -n "(?:SYN|ERR|SUG)[0-9]{4}" \
  packages/runtime/src \
  packages/compiler/src \
  packages/markscript/src \
  packages/manuals/manuals/diagnostics
```

Every diagnostic page must correspond to an emitted code. Every emitted
MarkScript code must have its page.

## Authoring handbooks and tutorials

Handbooks explain stable contracts by subject. Tutorials guide a reader toward
one outcome. Both are free-form `.ms` documents and can use the whole language.
Use straightforward Markdown for static material.

A handbook should include:

- a clear audience and scope;
- exact contracts and execution rules;
- tables where repeated mappings matter;
- examples that are valid for the current implementation;
- source pointers for agents and maintainers;
- API names together with their operational effects.

A tutorial should include prerequisites, a concrete target, a sequence of
working steps, expected output, and recovery points. Link to handbooks for
detailed reference material.

Create a manual page for a stable contract, a complete task, or a recovery
procedure. Direct getters and isolated flags can remain in API documentation.

## Build and import model

The manuals package follows runtime and compiler in the build order:

```text
@markscript/runtime
  -> @markscript/compiler
  -> @markscript/manuals
  -> markscript CLI and language server
  -> VS Code extension
```

Runtime and compiler compile the catalog's `.ms` sources, so the compiled
catalog is unavailable while those packages build. Packages built after the
manuals package may import it.

For each source, the build:

1. calls the compiler's non-executing graph bundle;
2. writes an importable entry and source map beneath `packages/manuals/dist/`;
3. imports and calls that trusted compiled entry;
4. validates the page identity appropriate to its manual category;
5. indexes the resulting `mdast.Root` and derived metadata.

The compiled catalog parses MDAST on module import. `getManual` returns the
full parsed page or index, including its root. `lookupManual` preserves lookup
failure detail, `listManuals` lists pages with an optional category filter, and
`manualDocumentationUrl` resolves the authored `.ms` location. Titles and
ordered section text are derived from that same root at import time. The `.ms`
page is the sole hand-authored prose record.

Readers and agents use the `.ms` source directly. Structural tools traverse the
catalog's MDAST, and presentation tools serialize or render that tree when
needed.

## Generated files

Edit manual content beneath `packages/manuals/manuals/`. Edit the generator or
catalog parser when the catalog contract changes.

The build replaces `packages/manuals/dist/` and generated declarations. Edit
the source page or build implementation and then rebuild these artifacts.

If build output is stale, fix the source or build script and rebuild. The
source `.ms` page remains the canonical human-readable version.

## Determinism and safety

Manual builds execute the compiled manual entries as trusted repository code.
Keep their behavior deterministic and local:

- avoid clocks, randomness, network requests, and machine-specific paths;
- limit manual callbacks to outputs produced by the manuals build;
- keep imported data versioned in the repository;
- use Markdown directly when it expresses the page clearly;
- send any necessary build-time logging to stderr so generated output remains
  clean.

These constraints make compiled catalogs reproducible across package and
extension builds.

## Reviewing a manual change

Review both reading modes.

For a diagnostic page:

```sh
bun run build
bun run markscript help
bun run markscript help handbooks
bun run markscript help HBK1005
bun run markscript help ERR1234
bun run markscript help ERR1234 > /tmp/ERR1234.md
```

The terminal form should be readable at the current terminal width. The
redirected form should contain Markdown serialized from the same MDAST and
include the `.ms` source location.

Also verify:

- the H1 and filename identity agree;
- all examples match current syntax and API names;
- the page states whether checking, compilation, or execution occurred;
- source pointers name current files and symbols;
- explanatory prose appears only in the `.ms` page;
- compiled catalog changes trace back to source edits.

## Implementation reference

| Concern | Source |
|---|---|
| Manual `.ms` sources | `packages/manuals/manuals/` |
| Diagnostic page parser and catalog | `packages/manuals/src/core.ts` |
| Compilation and catalog build | `packages/manuals/scripts/build.ts` |
| CLI lookup and human/raw rendering | `packages/markscript/src/cli.ts`, `packages/markscript/src/document-output.ts` |
| LSP diagnostic links | `packages/language-server/src/protocol.ts` |
| Extension packaging of pages | `packages/vscode-markscript/build.ts` |
| Code allocation and repository rules | `AGENTS.md` |

Each manual's `.ms` file is canonical. The build compiles it into MDAST, and
all manual interfaces refer to that same page.
