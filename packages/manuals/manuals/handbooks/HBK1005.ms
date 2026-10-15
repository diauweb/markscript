# HBK1005 — Diagnostics and manual authoring

Human-readable `.ms` pages are the MarkScript manual sources.
The build compiles them with the standard MarkScript tools.
It executes their document entries as trusted repository code and indexes the resulting MDAST.

Readers, editors, the CLI, and agents use the same content. Markdown contains text. MDAST gives its structured representation.

Manual sources are under `packages/manuals/manuals/`.
`packages/manuals/scripts/build.ts` and `packages/manuals/src/core.ts` implement the build and parser.
The `.ms` files are the only authored human-readable copies.
The build emits importable JavaScript into the package's `dist/` directory.

## Manual categories

| Category | Source layout | Purpose |
|---|---|---|
| Diagnostic man pages | `packages/manuals/manuals/diagnostics/CODE.ms` | Exact help for one emitted diagnostic |
| Handbooks | `packages/manuals/manuals/handbooks/HBK####.ms` | Stable, detailed reference by concern |
| Tutorials | `packages/manuals/manuals/tutorials/TUT####.ms` | Goal-oriented, end-to-end learning material |

Use one document for one subject.
Create a separate page for a different selector or reader task.

## Selectors and indexes

The catalog gives every page and virtual index a stable selector.

| Manual | Selector |
|---|---|
| Root index | Empty string (shown by `markscript help`) |
| Category index | `diagnostics`, `tutorials`, or `handbooks` |
| Diagnostic page | Its code, such as `ERR1104` |
| Tutorial page | Its code, such as `TUT1001` |
| Handbook page | Its code, such as `HBK1003` |

The catalog converts selectors to uppercase for lookup. Links and authored references use the uppercase code.

## Page identity

Each page has exactly one source file. Its filename is the uppercase code.
Its first node is an H1 with that code, an em dash, and a short title.

```markdown
# ERR1234 — Short title

Any useful Markdown follows.
```

The identity H1 is the only required structure. The body can contain:

- An explanation in one paragraph.
- A troubleshooting decision tree.
- A tutorial.
- Multiple valid and invalid examples.
- Recovery or migration procedures for external user data.
- Implementation notes and source links.
- Domain-specific sections.

`Problem` and `Fix` are optional names for short error page sections.
Select section names for the subject.

## Code prefixes and allocation

Authoritative manual codes have a three-letter prefix and exactly four digits.

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

Select a code from the subsystem that detects and explains the failure.
TypeScript diagnostics keep their `TS####` codes outside MarkScript code ranges.

An unshipped code has one identity. Use it directly without aliases, deprecation records, migration maps, or compatibility lookup paths.

Assign tutorial and handbook numbers in reading order, from 1001.
Keep existing numbers when you add or change text.

## Diagnostic page content

Start with the emitted code, failed rule, and detection phase.
Give sufficient context for the reader to select a correction directly from the manual.

A diagnostic page must answer the applicable questions:

1. Which invariant failed?
2. Which phase detected it?
3. Did checks, compilation, or execution occur?
4. Which source or MDAST structures commonly cause it?
5. Which message or path evidence identifies the cause?
6. Which changes keep the intended document semantics?
7. Which APIs or source files define the rule?

Select section names that describe the content. For example:

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

Runtime and compiler code contains the short emitted message.
The `.ms` page contains explanations, examples, investigation procedures, and recovery guidance.
Keep explanations in the manual page. TypeScript constants contain short emitted messages.
Generator logic compiles and indexes pages.

Store the information as follows:

```text
emitter
  -> code, severity, exact local message, source location/path

manual page
  -> concepts, examples, investigation, recovery, related rules
```

The CLI prints the exact message, then `markscript help CODE` and the document URL.
The language server keeps the exact code and adds the URL as LSP `codeDescription`.
Both interfaces refer to the same page.

## Adding a new diagnostic

Update the emitter and its manual in the same change.

1. Confirm that the condition is a MarkScript failure for which a stable code is necessary.
   Reuse an existing code for the same condition.
   Propagated TypeScript and user-library exceptions keep their original identities.
2. Select an unused number in the detecting subsystem's range.
3. Add `packages/manuals/manuals/diagnostics/CODE.ms` with the exact identity H1 and an applicable body.
4. Emit the exact code from the detecting package.
   Include the most exact available filename, source position, MDAST path, and cause.
5. For a new or changed language contract, update the design document.
6. Run the manuals build to update the importable catalog.
7. Run the source-integrity test to compare emitted codes and authored pages.
8. If link behavior changed, verify the actual CLI or LSP interface.

Before code number allocation, search the sources:

```sh
rg -n "(?:SYN|ERR|SUG)[0-9]{4}" \
  packages/runtime/src \
  packages/compiler/src \
  packages/markscript/src \
  packages/manuals/manuals/diagnostics
```

Each diagnostic page must correspond to an emitted code. Each emitted MarkScript code must have a page.

## Authoring handbooks and tutorials

Handbooks explain stable contracts by subject. Tutorials guide readers to one result.
Both use `.ms` and can use the full language.
Use standard Markdown for static content.

A handbook should include:

- Clear audience and scope.
- Exact contracts and execution rules.
- Tables for repeated maps.
- Valid examples for the current implementation.
- Source locations for agents and maintainers.
- API names with their operational effects.

A tutorial must include prerequisites, a concrete target, working steps, expected output, and recovery points.
Link detailed references to handbooks.

Create a manual page for a stable contract, a full task, or a recovery
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

Runtime and compiler compile the catalog's `.ms` sources.
The compiled catalog is thus unavailable during their build. Packages after the manuals build can import it.

For each source, the build:

1. Calls the compiler's static graph bundler.
2. Writes an importable entry and source map under `packages/manuals/dist/`.
3. Imports and calls the trusted compiled entry.
4. Validates the page identity for its manual category.
5. Indexes the resulting `mdast.Root` and derived metadata.

The compiled catalog parses MDAST on module import.
`getManual` returns the full parsed page or index, including its root.
`lookupManual` keeps lookup failure details. `listManuals` lists pages with an optional category filter.
`manualDocumentationUrl` resolves the authored `.ms` location.

The catalog derives titles and ordered section text from the same root at import time.
The `.ms` page is the only manually authored text record.

Readers and agents use `.ms` source directly. Structural tools traverse catalog MDAST.
Presentation tools serialize or render that tree as necessary.

## Generated files

Edit manual content beneath `packages/manuals/manuals/`. Edit the generator or
catalog parser when the catalog contract changes.

The build replaces `packages/manuals/dist/` and generated declarations. Edit
the source page or build implementation and then rebuild these artifacts.

For stale build output, correct the source or build script. Then rebuild.
The `.ms` source stays the human-readable version.

## Determinism and safety

Manual builds execute the compiled manual entries as trusted repository code.
Keep their behavior deterministic and local:

- Keep pages free of clock, randomness, network, and machine-specific dependencies.
- Limit manual callbacks to outputs from the manuals build.
- Keep imported data versioned in the repository.
- Use Markdown directly when it clearly expresses the page.
- Send necessary build logs to stderr for clean generated output.

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

Verify that the terminal form is readable at the current width.
Verify that redirected output contains Markdown from the same MDAST and includes the `.ms` source location.

Also verify:

- H1 and filename identities agree.
- Examples use current syntax and API names.
- The page states whether checks, compilation, or execution occurred.
- Source references identify current files and symbols.
- Explanations appear only in the `.ms` page.
- Compiled catalog changes come from source edits.

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

Each manual's `.ms` file is its source. The build compiles it to MDAST.
All manual interfaces refer to the same page.