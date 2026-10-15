# HBK1004 — CLI commands and document output

The `markscript` executable gives five commands:

- `check` parses source and checks types.
- `compile` makes callable ESM.
- `format` formats MarkScript source.
- `run` executes trusted code and displays the finalized document.
- `help` reads the manual catalog.

`check` performs static analysis, `compile` emits callable ESM, and `format`
rewrites source text. `run` executes the module and its document entry.

`packages/markscript/src/cli.ts` implements commands.
`packages/markscript/src/document-output.ts` implements shared MDAST serialization and terminal rendering.

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

File arguments must use `.ms`. Unknown options and extra positional arguments cause errors.
`format --write` and `format --check` cannot be used together.

## Checking

```sh
markscript check report.ms
markscript check report.ms --project ./tsconfig.json
```

`check` parses source, validates MarkScript structure, and resolves reachable relative `.ms` imports.
It runs the TypeScript checker with the selected project profile.
It prints diagnostics to stderr and returns after analysis finishes.

This static analysis is suitable for editors, CI, and source inspection.

## Compiling

```sh
markscript compile report.ms
markscript compile report.ms -o build/report.mjs
markscript compile report.ms -o build/report.mjs --source-map
markscript compile report.ms --transpile-only
```

The default output replaces the `.ms` suffix with `.mjs` beside the input.
Use `--output` to select another path. The output path must differ from the source path.

Compilation calls `bundleFile`, which uses Bun's build API.
It bundles relative `.ms` and TypeScript modules into callable ESM. Package imports stay external.
The command writes output only if frontend, type-check, and bundle diagnostics permit it.

`--source-map` writes `OUTPUT.map`, sets its `file` field to the output basename, and appends a corresponding `sourceMappingURL` comment.
The compiler maps locations to original `.ms` sources.

`--transpile-only` omits semantic TypeScript checks. Parsing, source-visible validation, and graph compilation still execute.
The generated entry keeps runtime validation.

## Formatting source

```sh
markscript format report.ms
markscript format report.ms --write
markscript format report.ms --check
```

`format` parses the file and formats Markdown, MDX, and TypeScript regions.
It verifies that the result parses as MarkScript.
It uses the source filename to read applicable Prettier configuration. The operation processes syntax only.

Without an option, `format` writes the formatted source to stdout.
`--write` or `-w` updates the input file and writes a completion message to stderr.
`--check` leaves stdout empty. If format changes are necessary, it returns status 1 and reports the file on stderr.
A file with the correct format returns status 0.

Use `--write` or `--check` separately.
Invalid source and a format result that fails the final parse cause command errors.

## Running

```sh
markscript run report.ms
markscript run report.ms -f mdast
markscript run report.ms --format pretty
markscript run report.ms --transpile-only
```

`run` executes trusted code. By default, it checks first, installs the Bun `.ms` loader, imports the module, and calls the default entry.
Module initializers, expressions, components, transforms, `onReady` callbacks, and imported libraries can all cause side effects.

The command waits for the full document lifetime:

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

CLI document output starts after entry resolution.
Asynchronous `onReady` work thus completes before Markdown, JSON, or terminal format conversion.

`--transpile-only` omits the TypeScript check before execution. Parser, loader, runtime, callback, and final-tree failures still apply.
The command executes source as trusted code.

## Output formats

`--format` and `-f` accept exactly three names. `markdown` is the default.

| Name | Intended reader | Output contract |
|---|---|---|
| `markdown` | Files, pipes, agents, Markdown tools | Markdown serialized from the finalized root |
| `mdast` | AST tools, debugging, agents | Two-space-indented JSON of the finalized root |
| `pretty` | A person in a terminal | Wrapped, styled rendering of supported MDAST |

All three formats display the same root. The callable module ABI and `runFile` return type stay `Promise<mdast.Root>`.

### Markdown

```sh
markscript run report.ms > report.md
```

The serializer uses `mdast-util-to-markdown` with official GFM, directive, and YAML frontmatter extensions.
It supports all runtime node types, including directives, deletion, task-list state, tables, footnotes, and YAML.
Markdown includes `node.data` metadata only if an extension defines syntax for it.

The serializer can change markers, escapes, spacing, or reference expansion. It keeps document semantics.

### MDAST JSON

```sh
markscript run report.ms --format mdast > report.json
```

JSON contains finalized node fields, remaining source positions, and `data` metadata.
Use it for exact AST structure. A JSON parse in another process makes mutable values.

### Pretty terminal rendering

```sh
markscript run report.ms -f pretty
```

The pretty renderer traverses finalized MDAST directly.
It displays headings, paragraphs, emphasis, strong text, deletion, inline and block code, nested lists, and task items.
It also displays blockquotes, links, images, tables, footnotes, HTML, YAML, and thematic breaks in a compact terminal layout.

Text wraps at terminal width, within 40–100 columns.
ANSI color is available only with a TTY, no `NO_COLOR` variable, and a `TERM` value other than `dumb`.
Use `pretty` to read documents. Use `mdast` for structural interchange.

### Document output failures

Format conversion occurs after successful execution. Adapter conversion failures report `ERR2101` and link its indexed manual.
Typical causes include cyclic JSON metadata and nodes outside a serializer extension's model.

An unknown format name also reports `ERR2101` with the exact accepted names.
The accepted names have no aliases.

## Stdout and stderr

`run` writes the selected finalized document to stdout. Executed source shares this stream.
Its writes can mix with Markdown or JSON and corrupt pipe output.

Use stderr for progress and source logs:

```mdx
{console.error('loading report data')}
```

| Stream | Standard CLI content |
|---|---|
| stdout | `run` document output, successful `help` page, and version or usage text |
| stderr | Diagnostics, errors, compile completion, and author-controlled logs |

For multiple outputs, use an `onReady` callback to write additional files.
The CLI waits for this callback before it prints the selected stdout representation.

## Manual help

```sh
markscript help
markscript help handbooks
markscript help HBK1004
markscript help ERR1104
```

`help` reads the compiled `.ms` manual catalog. Without a selector, it displays the root index.
A category name displays its category index. Diagnostic codes select diagnostic pages.
`TUT####` and `HBK####` select tutorials and handbooks.

| Selector | Result |
|---|---|
| empty | Root manual index |
| `diagnostics`, `tutorials`, `handbooks` | Category index |
| `ERR1104` | One diagnostic page |
| `TUT1001` | One tutorial page |
| `HBK1003` | One handbook page |

In an interactive terminal, `help` displays the selected page or index as parsed MDAST.
It applies heading, list, quote, code, emphasis, and link styles. Then it prints the document location.

With redirected stdout, `help` serializes catalog MDAST as Markdown. Then it appends the `.ms` source URL:

```sh
markscript help HBK1003 > compiler-handbook.md
```

The body can contain any Markdown explanation, tutorial, worked example, or recovery procedure.
Manual pages have no required JSON document schema.

Compiler and runtime summaries print the exact emitted diagnostic, `markscript help CODE`, and the individual document URL.
TypeScript diagnostics keep their `TS####` identity. MarkScript pages cover `SYN####`, `ERR####`, and `SUG####`.
Invalid selectors and missing pages suggest the root or applicable category index.

## Project selection

`check`, `compile`, and `run` accept `-p` or `--project` with a TypeScript configuration file or directory.
A directory resolves to its `tsconfig.json`. Without the option, the compiler finds the nearest configuration from the source file.
Programmatic hosts can pass `tsconfig: false`. The CLI accepts only a path.

The project controls TypeScript strictness, libraries, paths, and ambient declarations.
The compiler gives required ESM, TSX runtime, module-resolution, and non-emitting checker options.

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

Keep these CLI execution rules:

- Checks do static analysis.
- Compilation makes callable ESM.
- Source format rewrites source text.
- Run resolves one finalized root.
- Document presentation starts after root resolution.