# TUT1001 — Create and run a document

This basic tutorial creates a MarkScript document, checks it, and renders Markdown.
Run the commands from the repository root.

## Prerequisites

Install [Bun](https://bun.sh/). Install workspace dependencies. Build the packages:

```sh
bun install
bun run build
```

Create directories for source and generated files:

```sh
mkdir -p docs build
```

## Create the source file

Create `docs/hello.ms`:

```mdx
export const project = 'Atlas'
export const completed = 3
export const planned = 4

# Status for {project}

Completed: {completed} of {planned} tasks.

- Prepare the data
- Review the document
- Publish the result
```

A `.ms` file combines Markdown with TypeScript expressions. Exported constants are standard named ESM exports.
Each expression inside braces inserts its value into the document.

The compiler generates the default export. This entry renders the document and returns an `mdast.Root`.

## Check the document

Run the parser and TypeScript checker:

```sh
bun run markscript check docs/hello.ms
```

A successful check exits with status `0` and writes no document.
`check` statically parses and analyzes the `.ms` import graph. Then it reports MarkScript and TypeScript diagnostics.

Select a TypeScript configuration when the document belongs to a project:

```sh
bun run markscript check docs/hello.ms --project tsconfig.json
```

## Render Markdown

Run the document:

```sh
bun run markscript run docs/hello.ms
```

`run` imports the module, renders the document, completes registered callbacks, and writes Markdown to stdout. The example makes:

```markdown
# Status for Atlas

Completed: 3 of 4 tasks.

- Prepare the data
- Review the document
- Publish the result
```

Use `run` only when you trust source imports and document callbacks to execute on the current machine.

## Select another output format

`run` supports three formats:

| Format | Output |
|---|---|
| `markdown` | Markdown text (default) |
| `mdast` | Indented JSON for finalized MDAST |
| `pretty` | Terminal text at the available width |

Examine the tree:

```sh
bun run markscript run docs/hello.ms --format mdast
```

Read the document in a terminal:

```sh
bun run markscript run docs/hello.ms --format pretty
```

The short format option is `-f`:

```sh
bun run markscript run docs/hello.ms -f pretty
```

## Write an output file

Redirect stdout to create a Markdown artifact:

```sh
bun run markscript run docs/hello.ms > build/hello.md
```

Send operational messages to stderr to keep stdout in the selected document format:

```ts
console.error('loaded project data')
```

Capture the two streams independently:

```sh
bun run markscript run docs/hello.ms > build/hello.md 2> build/hello.log
```

## Use the authoring loop

During edits, run these commands:

```sh
bun run markscript check docs/hello.ms
bun run markscript run docs/hello.ms --format pretty
bun run markscript run docs/hello.ms > build/hello.md
```

When a diagnostic reports a MarkScript code, open its manual page:

```sh
bun run markscript help ERR1104
```

## Next

Continue with [Markdown, expressions, and JSX](./TUT1002.ms).
