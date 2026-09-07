# TUT1006 — Build and publish an msdocs site

This advanced tutorial turns MarkScript documents into a static website. It
starts with one page, then defines multi-page navigation and custom MDAST
rendering.

The examples use the repository command `bun run msdocs`. A project with the
package binary installed can use `msdocs` directly.

## Build one page

Create `docs/release-notes.ms`:

```mdx
export const version = '2026.08'

# Atlas release {version}

## Changes

- Added regional health summaries.
- Published the deployment checklist.
```

Build the page:

```sh
bun run msdocs build docs/release-notes.ms \
  --out-dir build/release-notes
```

msdocs checks and executes the `.ms` entry, renders its MDAST as HTML, and
writes a static site. The first level-one heading becomes the page and site
title.

The output directory contains:

```text
build/release-notes/
  index.html
  404.html
  assets/
    msdocs.css
    msdocs.js
  .msdocs-manifest.json
```

Set an explicit site title or TypeScript project when required:

```sh
bun run msdocs build docs/release-notes.ms \
  --title "Atlas releases" \
  --project tsconfig.docs.json \
  --out-dir build/release-notes
```

`--transpile-only` skips semantic TypeScript checking and still executes the
document and validates its final MDAST.

## Preview the site

Build and serve the same page:

```sh
bun run msdocs serve docs/release-notes.ms \
  --out-dir build/release-notes \
  --host 127.0.0.1 \
  --port 4173
```

Open `http://127.0.0.1:4173`. The preview server accepts `GET` and `HEAD`,
serves generated files, redirects directory indexes, and uses the generated
`404.html` page.

`serve` performs one build when it starts. Restart the command after changing a
source file.

## Define a multi-page site

A multi-page build reads a JavaScript or TypeScript module whose default export
is a `SiteDefinition`.

Create two page sources:

```text
docs/
  index.ms
  setup.ms
msdocs.config.ts
```

Create `msdocs.config.ts`:

```ts
import { runFile } from '@markscript/markscript'
import type { SiteDefinition } from '@markscript/msdocs'

const homeRoot = await runFile('docs/index.ms')
const setupRoot = await runFile('docs/setup.ms')

const site = {
  title: 'Atlas engineering',
  home: {
    path: '',
    title: 'Overview',
    root: homeRoot,
  },
  sections: [
    {
      title: 'Guides',
      pages: [
        {
          path: 'guides/setup',
          title: 'Set up Atlas',
          root: setupRoot,
        },
      ],
    },
  ],
} satisfies SiteDefinition

export default site
```

Build and preview the site module:

```sh
bun run msdocs build msdocs.config.ts --out-dir build/site
bun run msdocs serve msdocs.config.ts --out-dir build/site --port 4173
```

Importing the configuration module executes its top-level code. Each `runFile`
call executes the corresponding MarkScript document and returns its finalized
root.

## Assign page paths

Each `SitePage.path` maps to one HTML file:

| Page path      | Output              |
| -------------- | ------------------- |
| empty string   | `index.html`        |
| `guides/`      | `guides/index.html` |
| `guides/setup` | `guides/setup.html` |

Paths are relative URL paths. msdocs rejects duplicate paths, colliding output
filenames, absolute paths, backslashes, and unsafe path segments before writing
the site.

Links between generated `.ms` or `.md` pages are rewritten to their HTML paths
when the destination belongs to the same site.

## Customize MDAST rendering

msdocs converts MDAST to HAST with `mdast-util-to-hast`. Unknown node types and
their children produce no HTML by default. A site can provide standard handlers
for application nodes.

This example renders every otherwise unknown node as `<mark>`:

```ts
const site: SiteDefinition = {
  title: 'Custom nodes',
  home,
  sections: [],
  mdastToHast: {
    unknownHandler(state, node) {
      return {
        type: 'element',
        tagName: 'mark',
        properties: { 'data-node': node.type },
        children: state.all(node),
      }
    },
  },
}
```

Use `mdastToHast.handlers` for named node types and `unknownHandler` for the
fallback. Each handler defines the generated tag, properties, and children.

## Rebuild generated files

`.msdocs-manifest.json` records every path generated in the output directory.
On the next build, msdocs overwrites recorded files, removes recorded files that
are absent from the new site, and preserves unrelated files.

An existing destination file outside the manifest causes the build to fail.
This prevents a site build from replacing files created by another process.

Edit source pages, the site definition, or the msdocs public assets, then run
the build again. Changes made directly to generated HTML are replaced on the
next build.

## Publish the static directory

Create the deployment artifact in CI:

```sh
bun install --frozen-lockfile
bun run build
bun run msdocs build msdocs.config.ts --out-dir dist/manual
```

Publish the contents of `dist/manual` with a static hosting service. The host
serves the HTML files and `assets/` directory; Bun and MarkScript are required
during the build.

Configure the host to use `index.html` for directory indexes and `404.html` for
missing pages. Upload the pages and assets from the same build.

## Verify the publication

Preview with the same source and options used by the production build:

```sh
bun run msdocs serve msdocs.config.ts \
  --out-dir build/site-preview \
  --host 127.0.0.1 \
  --port 4173
```

Check the home page, navigation, generated links, custom nodes, assets, and 404
response before publishing `dist/manual`.

## Reference

- [CLI commands and document output](../handbooks/HBK1004.ms)
- [Compiler, module graph, and callable ESM ABI](../handbooks/HBK1003.ms)
- [Agent and developer workflow](../handbooks/HBK1006.ms)
