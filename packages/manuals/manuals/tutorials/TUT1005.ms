# TUT1005 — Transform callbacks, ready callbacks, and output pipelines

This advanced tutorial changes a full document with `onTransform`.
It reads validated results with `onReady` and writes reproducible CLI artifacts.
First, complete [TUT1004](./TUT1004.ms) for project and import setup.

## Follow the document phases

One call to a generated document entry proceeds in this order:

```text
initialize ESM modules
  -> render Markdown, expressions, and components
  -> lower values to mdast.Root
  -> await transform callbacks in registration order
  -> validate the complete root
  -> deep-freeze the root
  -> await ready callbacks in registration order
  -> return the finalized root
```

The CLI formats and writes the returned root after this sequence completes.

## Register callbacks during rendering

Import lifecycle functions from `markscript`. Call them in document expressions:

```mdx
import { onReady, onTransform } from '@markscript/markscript'

{
  onTransform(({root}) => {
    // root is mutable and contains the complete document.
  })
}

{
  onReady(({root}) => {
    // root is validated and deeply frozen.
  })
}

# Operations report
```

Registration expressions emit no document nodes. Registration occurs during ordered rendering, including after an async component resumes.
Callbacks can be async.

Calls at module initialization, inside another callback, or after entry completion report `ERR1301`.

## Edit the full tree

A transform receives the full mutable root.
Use it for document-wide operations, such as heading IDs, reference resolution, node changes, and outline generation.

```mdx
import { onTransform } from '@markscript/markscript'
import { selectAll } from 'unist-util-select'

{
  onTransform(({root}) => {
    for (const [index, heading] of selectAll('heading', root).entries()) {
      heading.data ??= {}
      heading.data.ref = {
        id: `heading-${index + 1}`
      }
    }
  })
}

# Operations report

## Availability

All regions were healthy.
```

Transforms execute sequentially. Each sees completed changes from the previous callback:

```mdx
{
  onTransform(async ({root}) => {
    await enrichReferences(root)
    root.data = {...root.data, referencesReady: true}
  })
}

{
  onTransform(({root}) => {
    if (root.data?.referencesReady !== true) {
      throw new Error('reference enrichment failed')
    }
    buildBacklinks(root)
  })
}
```

## Leave a valid MDAST root

After the final transform callback, runtime validation checks:

- Node types and required fields.
- Flow, phrasing, and list content relationships.
- One occurrence per node object, without ancestry cycles.
- Scalar, array, or plain-object metadata values.

Convert application values while the tree remains mutable:

```ts
node.data ??= {}
node.data.source = {
  id: record.id,
  label: record.label,
  fetchedAt: record.fetchedAt.toISOString(),
}
```

Validation rejects roots with functions, accessors, maps, sets, dates, response objects, or class instances.
An invalid root stops the document before ready callbacks.

## Write a final artifact

An `onReady` callback receives the validated, deeply frozen root.
Use it for serialization, publication, audit records, or requests that use the final document.

```mdx
import { onReady, onTransform } from '@markscript/markscript'
import { writeFile } from 'node:fs/promises'
import { selectAll } from 'unist-util-select'

{
  onTransform(({root}) => {
    root.data = {
      ...root.data,
      linkCount: selectAll('link', root).length
    }
  })
}

{
  onReady(async ({root}) => {
    await writeFile(
      'build/report.mdast.json',
      `${JSON.stringify(root, null, 2)}\n`
    )
  })
}

# Report

See the [dataset](./dataset.json).
```

Create the destination and run the entry:

```sh
mkdir -p build
bun run markscript check docs/report.ms
bun run markscript run docs/report.ms > build/report.md
```

`build/report.mdast.json` and `build/report.md` represent the same finalized root.
The `onReady` write completes before CLI Markdown output to stdout.

## Handle callback failures

Callbacks stop at the first failure:

| Failure | Remaining work |
|---|---|
| Render or MDAST conversion failure | No transform or ready callbacks |
| Transform failure | No later transforms, validation, or ready callbacks |
| Validation failure | No ready callbacks |
| Ready callback failure | No later ready callbacks. The entry rejects |
| CLI format failure | Ready callbacks are already completed |

MarkScript propagates callback exceptions. Earlier file, network, and database operations keep their external effects.
Use operation identifiers when the caller can retry an entry.

## Keep CLI streams separate

The CLI writes the selected document format to stdout.
Send document status messages to stderr:

```ts
console.error('loaded 24 records')
process.stderr.write('publishing report\n')
```

Capture both streams:

```sh
bun run markscript run docs/report.ms \
  --format markdown \
  > build/report.md \
  2> build/report.log
```

Query a finalized MDAST stream with `jq`:

```sh
bun run markscript run docs/report.ms --format mdast |
  jq '.children[] | select(.type == "heading")'
```

## Use the programmatic result

Call `runFile` for the finalized root in a Bun application:

```ts
import { runFile, stripData } from '@markscript/markscript'

const root = await runFile('docs/report.ms', {
  tsconfig: 'tsconfig.json',
})
const rootWithoutData = stripData(root)

console.log(root.type)
console.log(rootWithoutData.children.length)
```

`runFile` returns MDAST directly. `stripData` creates a detached copy without node `data` fields.

## Automate the workflow

Use the commands according to the artifact being made:

| Command                  | Result                                     | Executes document code? |
| ------------------------ | ------------------------------------------ | ----------------------- |
| `format FILE.ms --check` | Verifies source formatting                 | no                      |
| `check FILE.ms`          | Reports parser and type diagnostics        | no                      |
| `compile FILE.ms`        | Writes callable ESM                        | no                      |
| `run FILE.ms`            | Returns and formats the finalized document | yes                     |
| `help SELECTOR`          | Displays a manual page or index            | no                      |

A CI sequence can check source format and types, compile, and run an approved entry:

```sh
bun run markscript format docs/report.ms --check
bun run markscript check docs/report.ms --project tsconfig.json
bun run markscript compile docs/report.ms \
  --project tsconfig.json \
  --source-map \
  --output build/report.mjs
bun run markscript run docs/report.ms \
  --project tsconfig.json \
  --format mdast \
  > build/report.json
```

The [runtime handbook](../handbooks/HBK1002.ms) defines registration, validation, freezing, concurrency, and failure behavior.
The [CLI handbook](../handbooks/HBK1004.ms) lists commands and options.

## Next

Continue with [Build and publish an msdocs site](./TUT1006.ms).
