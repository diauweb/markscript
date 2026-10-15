# TUT1006 — Build and publish an msdocs site

This advanced tutorial converts MarkScript documents to a static website.
It starts with one page. Then it defines navigation for multiple pages and custom MDAST rendering.

Examples use the repository command `bun run msdocs`.
With the package binary installed, a project can use `msdocs` directly.

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

msdocs checks and executes the `.ms` entry, renders MDAST as HTML, and writes a static site.
The first level-one heading becomes the page and site title.

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

`--transpile-only` omits semantic TypeScript checks. It still executes the document and validates final MDAST.

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

`serve` builds once at startup. After a source file change, restart the command.

## Define a multi-page site

A build with multiple pages reads a JavaScript or TypeScript module with `SiteDefinition` as its default export.

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

A configuration module import executes its top-level code.
Each `runFile` call executes the corresponding document and returns its finalized root.

## Assign page paths

Each `SitePage.path` maps to one HTML file:

| Page path      | Output              |
| -------------- | ------------------- |
| empty string   | `index.html`        |
| `guides/`      | `guides/index.html` |
| `guides/setup` | `guides/setup.html` |

Paths are relative URL paths.
Before output, msdocs rejects duplicate paths, colliding filenames, absolute paths, backslashes, and unsafe segments.

msdocs rewrites links between generated `.ms` or `.md` pages to HTML paths if the destination is in the same site.

## Customize MDAST rendering

msdocs converts MDAST to HAST with `mdast-util-to-hast`. By default, unknown nodes and their children make no HTML.
A site can give standard handlers for application nodes.

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

`.msdocs-manifest.json` records each generated path.
On the next build, msdocs replaces recorded files and removes those absent from the new site. It keeps unrelated files.

An existing destination file outside the manifest causes the build to fail.
The site build thus keeps files from other processes.

Edit source pages, the site definition, or msdocs public assets. Then build again.
The next build replaces direct changes to generated HTML.

## Publish the static directory

Create the deployment artifact in CI:

```sh
bun install --frozen-lockfile
bun run build
bun run msdocs build msdocs.config.ts --out-dir dist/manual
```

Publish `dist/manual` content with a static hosting service.
The host serves HTML files and `assets/`. Bun and MarkScript are necessary during the build.

Configure the host to use `index.html` for directory indexes.
Configure `404.html` for missing pages. Upload pages and assets from the same build.

## Verify the publication

Preview with the same source and options used by the production build:

```sh
bun run msdocs serve msdocs.config.ts \
  --out-dir build/site-preview \
  --host 127.0.0.1 \
  --port 4173
```

Before publication, check the home page, navigation, generated links, custom nodes, assets, and 404 response.

## Reference

- [CLI commands and document output](../handbooks/HBK1004.ms)
- [Compiler, module graph, and callable ESM ABI](../handbooks/HBK1003.ms)
- [Agent and developer workflow](../handbooks/HBK1006.ms)
