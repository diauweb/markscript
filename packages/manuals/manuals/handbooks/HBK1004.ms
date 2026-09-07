# HBK1004 — CLI commands and document output

The `markscript` executable provides five commands:

- `check` parses and type-checks source;
- `compile` produces callable ESM;
- `format` formats MarkScript source;
- `run` executes trusted code and presents the finalized document;
- `help` reads the manual catalog.

`check` performs static analysis, `compile` emits callable ESM, and `format`
rewrites source text. `run` executes the module and its document entry.

The command implementation is `packages/markscript/src/cli.ts`. Shared MDAST
serialization and terminal rendering are implemented in
`packages/markscript/src/document-output.ts`.

## Command synopsis

```text
markscript check FILE.ms [-p|--project tsconfig.json]

markscript compile FILE.ms
  [-o|--output FILE.mjs]
  [-p|--project tsconfig.json]
  [--source-map]
  [--transpile-only]

markscript format FILE.ms
  [-w|--write]
  [--check]

markscript run FILE.ms
  [-p|--project tsconfig.json]
  [-f|--format markdown|mdast|pretty]
  [--transpile-only]

markscript help [SELECTOR]
markscript --help
markscript --version
```

The file arguments must use the `.ms` extension. Unknown options and extra
positional arguments are errors. `format --write` and `format --check` are
mutually exclusive.

## Checking

```sh
markscript check report.ms
markscript check report.ms --project ./tsconfig.json
```

`check` parses the source, performs MarkScript structural validation, resolves
reachable relative `.ms` imports, and runs the TypeScript checker using the
selected project profile. It prints diagnostics to stderr and returns only
after analysis finishes.

This static analysis is suitable for editors, CI, and source inspection.

## Compiling

```sh
markscript compile report.ms
markscript compile report.ms -o build/report.mjs
markscript compile report.ms -o build/report.mjs --source-map
markscript compile report.ms --transpile-only
```

The default output removes the `.ms` suffix and adds `.mjs` beside the input.
`--output` can select another path. The output path must differ from the source
path.

Compilation calls `bundleFile`, which uses Bun's build API. Relative `.ms` and
TypeScript modules are bundled into callable ESM; package imports remain
external imports. The command writes output after frontend, checking, and
bundling diagnostics allow it.

`--source-map` writes `OUTPUT.map`, adjusts its `file` field to the output
basename, and appends a matching `sourceMappingURL` comment. Locations are
composed back to original `.ms` sources.

`--transpile-only` skips semantic TypeScript checking. Parsing, source-visible
MarkScript validation, and graph compilation still run. The generated entry
retains runtime validation.

## Formatting source

```sh
markscript format report.ms
markscript format report.ms --write
markscript format report.ms --check
```

`format` parses the file, formats its Markdown/MDX and TypeScript regions, and
verifies that the result parses as MarkScript. It reads applicable Prettier
configuration using the source filename and completes through syntax processing.

With no option, the formatted source is written to stdout. `--write` or `-w`
updates the input file and writes a completion message to stderr. `--check`
writes nothing to stdout; it returns status 1 and reports the file on stderr
when formatting would change it. An already formatted file returns status 0.

`--write` and `--check` are mutually exclusive. Invalid MarkScript source and a
formatting result that fails the final parse are command errors.

## Running

```sh
markscript run report.ms
markscript run report.ms -f mdast
markscript run report.ms --format pretty
markscript run report.ms --transpile-only
```

`run` is trusted execution. By default it checks first, installs the Bun `.ms`
loader, imports the module, and calls its generated default document entry.
Module initializers, document expressions, components, transform callbacks, `onReady`
callbacks, and imported libraries may all produce side effects.

The command awaits the entire document lifetime:

```text
module import
  -> render
  -> baseline MDAST
  -> awaited transform callbacks
  -> validation and deep freeze
  -> awaited ready callbacks
  -> finalized mdast.Root
  -> selected stdout presentation
```

The CLI begins document output after the entry resolves. Asynchronous `onReady`
work therefore completes before Markdown, JSON, or the pretty terminal view is
formatted.

`--transpile-only` skips the pre-execution TypeScript check. Parser, loader,
runtime, callback, and final-tree failures remain active. The command still
executes the source as trusted code.

## Output formats

`--format` and `-f` accept exactly three names. `markdown` is the default.

| Name | Intended reader | Output contract |
|---|---|---|
| `markdown` | Files, pipes, agents, Markdown tools | Markdown serialized from the finalized root |
| `mdast` | AST tools, debugging, agents | Two-space-indented JSON of the finalized root |
| `pretty` | A person in a terminal | Wrapped, styled rendering of supported MDAST |

All three formats present the same root. The callable module ABI and the
`runFile` return type remain `Promise<mdast.Root>`.

### Markdown

```sh
markscript run report.ms > report.md
```

The serializer uses `mdast-util-to-markdown` with the official GFM, directive,
and YAML frontmatter extensions. It covers the full node vocabulary accepted by
the runtime, including directives, deletion, task-list state, tables, footnotes,
and YAML.
Markdown includes `node.data` metadata only when an extension defines syntax
for it.

The serializer may change markers, escapes, spacing, or reference expansion
while preserving the document semantics.

### MDAST JSON

```sh
markscript run report.ms --format mdast > report.json
```

The JSON representation contains the finalized node fields, source positions
that survived generation, and `data` metadata. It is useful when exact AST
shape matters. Parsing the JSON in another process produces mutable values.

### Pretty terminal rendering

```sh
markscript run report.ms -f pretty
```

The pretty renderer traverses the finalized MDAST directly. It presents
headings, paragraphs, emphasis, strong text, deletion, inline and block code,
nested lists, task items, blockquotes, links, images, tables, footnotes, HTML,
YAML, and thematic breaks in a compact terminal layout.

Text wraps at the terminal width, clamped to 40–100 columns. ANSI color is
enabled only for a TTY and is disabled when `NO_COLOR` is present or
`TERM=dumb`. Use `pretty` for reading and `mdast` for structural interchange.

### Document output failures

Formatting happens after successful document execution. Adapter conversion
failures report `ERR2101` and link its indexed manual. Typical causes include
cyclic JSON metadata or a node shape outside a serializer extension's model.

An unknown format name also reports `ERR2101` with the exact accepted names.
The accepted names have no aliases.

## Stdout and stderr

`run` writes the selected finalized document to stdout. Writes from the executed
source share that stream with Markdown or JSON and can corrupt piped output.

Use stderr for progress and source-side logs:

```mdx
{console.error('loading report data')}
```

| Stream | Normal CLI content |
|---|---|
| stdout | `run` document output; successful `help` page; version/usage text |
| stderr | diagnostics, errors, compile completion, and author-controlled logging |

For programs that produce multiple outputs, an `onReady` callback can write
additional files. The CLI waits for that callback before printing the selected
stdout representation.

## Manual help

```sh
markscript help
markscript help handbooks
markscript help HBK1004
markscript help ERR1104
```

`help` reads the compiled `.ms` manual catalog. With no selector it displays
the root index. A category name displays that category's index. Diagnostic
codes select diagnostic pages; `TUT####` and `HBK####` select tutorials and
handbooks.

| Selector | Result |
|---|---|
| empty | Root manual index |
| `diagnostics`, `tutorials`, `handbooks` | Category index |
| `ERR1104` | One diagnostic page |
| `TUT1001` | One tutorial page |
| `HBK1003` | One handbook page |

In an interactive terminal, `help` renders the selected page or index's parsed MDAST with
heading, list, quote, code, emphasis, and link styling, followed by the document
location.

When stdout is redirected, `help` serializes the catalog MDAST as Markdown and
then appends its `.ms` source URL:

```sh
markscript help HBK1003 > compiler-handbook.md
```

The body is free-form Markdown and can contain explanations, tutorials, worked
examples, or recovery steps. Manual pages have no required JSON document
schema.

Compiler and runtime diagnostic summaries print the exact emitted diagnostic,
the `markscript help CODE` command, and the individual document URL. TypeScript
diagnostics retain their `TS####` identity. MarkScript diagnostic pages apply
to `SYN####`, `ERR####`, and `SUG####` codes. Invalid selectors and missing
pages suggest the root or appropriate category index.

## Project selection

`check`, `compile`, and `run` accept `-p` or `--project` with a TypeScript
configuration file or directory. The compiler resolves a directory to its
`tsconfig.json`. When the option is absent, it discovers the nearest config
from the source file. Programmatic hosts can pass `tsconfig: false` through the
compiler API; the CLI accepts only a path.

The project controls TypeScript policy such as strictness, libraries, paths,
and ambient declarations. The compiler supplies the ESM, TSX runtime,
module-resolution, and non-emitting checker options required by MarkScript.

## Exit status

| Status | Meaning |
|---:|---|
| 0 | Requested command completed successfully |
| 1 | Compiler/check diagnostics prevented success, `format --check` found changes, or the requested manual code was missing |
| 2 | Invalid CLI usage, invalid output format, or an execution/formatting exception reached the CLI |

Programmatic callers determine diagnostic severity from the compiler's
structured `Diagnostic` objects.

## Implementation reference

| Concern | Source |
|---|---|
| Citty command definitions and exit handling | `packages/markscript/src/cli.ts` |
| Markdown, JSON, and pretty presentation | `packages/markscript/src/document-output.ts` |
| File checking, compilation, and running | `packages/compiler/src/` |
| Diagnostic/manual lookup | `packages/manuals/dist/index.js` and `packages/manuals/src/core.ts` |
| User-visible code manuals | `packages/manuals/manuals/diagnostics/` |

CLI changes must preserve these execution rules: checking performs static
analysis, compilation produces callable ESM, formatting rewrites source,
running resolves one finalized root, and document presentation begins afterward.
