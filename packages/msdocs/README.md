# msdocs

`msdocs` generates static sites from MarkScript and MDAST. Each CLI command must have an input:

- A `.ms` document makes a site with one page.
- A `.ts`, `.mts`, `.js`, or `.mjs` module gives a site with multiple pages through its default `SiteDefinition` export.

## CLI

From the workspace root:

```sh
bun run msdocs build examples/report.ms --out-dir site
bun run msdocs serve examples/report.ms --port 4173
bun run msdocs serve packages/manuals/msdocs.config.ts
```

The MarkScript manual uses the site module at `packages/manuals/msdocs.config.ts`.
The root `bun run manual` script serves this module.

For a site from one MarkScript document, the first level-one heading gives the page and site title.
Use `--title` to change the site title. `.ms` inputs also accept `--project` and `--transpile-only`.

For a multi-page site, create a module whose default export satisfies
`SiteDefinition`:

```ts
import type {SiteDefinition} from '@markscript/msdocs'
import {overviewRoot, setupRoot} from './content.ts'

export default {
  title: 'Atlas engineering',
  home: {
    path: '',
    title: 'Overview',
    root: overviewRoot,
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
```

`content.ts` exports standard `mdast.Root` values from the project's content pipeline.
Build or preview the module directly:

```sh
msdocs build msdocs.config.ts --out-dir site
msdocs serve msdocs.config.ts --port 4173
```

Both input forms execute code. A `.ms` input executes the full MarkScript lifetime.
The site generator imports a site module as ESM.

`serve` performs one build and starts a preview server. Restart it to rebuild.

## Programmatic interface

```ts
import {
  buildMarkScriptSite,
  buildSite,
  buildSiteModule,
  serveSite,
  type SiteDefinition,
} from '@markscript/msdocs'

declare const site: SiteDefinition

await buildSite(site, {outDir: 'site'})
await buildMarkScriptSite('report.ms', {outDir: 'report-site'})
await buildSiteModule('msdocs.config.ts', {outDir: 'module-site'})

const server = await serveSite({directory: 'site', port: 8000})
console.error(server.url)
```

`buildSite` accepts a `SiteDefinition` with a home page, navigation sections, and any number of MDAST page roots.
`buildMarkScriptSite` adapts one MarkScript document into one site page.
`buildSiteModule` imports a JavaScript or TypeScript site module and builds its default export.

## Output ownership

The default output directory is `site/`. `msdocs` records generated files in `.msdocs-manifest.json`.
Each build updates recorded files and removes stale recorded files.
It keeps unrelated files and reports path collisions with files that it does not own.

The generated files use standard static HTML.
The preview server gives extensionless routes for leaf pages and routes with a slash for indexes:

```text
index.html
guides/index.html
guides/getting-started.html
assets/msdocs.css
assets/msdocs.js
404.html
```

Sites with multiple pages have a page sidebar with a filter.
Pages with section headings also have an “On this page” outline.
A standalone `.ms` document uses the same typography. It reserves no space for an empty sidebar.

## Custom MDAST conversion

The standard MDAST conversion defines the built-in HTML map.
By default, unknown nodes, including directives, make no output.

`SiteDefinition.mdastToHast` accepts the standard `mdast-util-to-hast` options.
Use `handlers` for selected node types or `unknownHandler` for a general
fallback:

```ts
export default {
  title: 'Custom nodes',
  home,
  sections: [],
  mdastToHast: {
    unknownHandler(state, node) {
      return {
        type: 'element',
        tagName: 'mark',
        properties: {'data-node': node.type},
        children: state.all(node),
      }
    },
  },
} satisfies SiteDefinition
```

The callback defines the tag, attributes, children, and omission policy.

## Presentation files

These files define presentation:

- `public/page.squirrelly`: Squirrelly page template.
- `public/assets/msdocs.css`: responsive theme.
- `public/assets/msdocs.js`: navigation filter and mobile menu.
- `public/404.html`: preview server 404 response page.

The package includes these files. Each build copies them into its output.
The page template receives the rendered MDAST body as HTML.