# msdocs

`msdocs` is a general-purpose static-site generator for MarkScript and MDAST.
Every CLI command takes an explicit input:

- a `.ms` document becomes a one-page site;
- a `.ts`, `.mts`, `.js`, or `.mjs` module supplies a multi-page site by
  default-exporting a `SiteDefinition` object.

## CLI

From the workspace root:

```sh
bun run msdocs build examples/report.ms --out-dir site
bun run msdocs serve examples/report.ms --port 4173
bun run msdocs serve packages/manuals/msdocs.config.ts
```

The MarkScript manual is an ordinary site module at
`packages/manuals/msdocs.config.ts`. The root `bun run manual` script serves
that module.

For a one-page MarkScript site, the first level-one heading supplies the page
and site title. Use `--title` to override the site title. `.ms` inputs also
accept `--project` and `--transpile-only`.

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

Here `content.ts` exports ordinary `mdast.Root` values from the project's
content pipeline. Build or preview the module directly:

```sh
msdocs build msdocs.config.ts --out-dir site
msdocs serve msdocs.config.ts --port 4173
```

Both input forms are executable. A `.ms` input runs through the complete
MarkScript lifetime, while a site module is imported as ESM.

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

`buildSite` accepts a `SiteDefinition` containing a home page, navigation
sections, and any number of MDAST page roots. `buildMarkScriptSite` is the
one-page adapter for a MarkScript document. `buildSiteModule` imports a
JavaScript or TypeScript site module and builds its default export.

## Output ownership

The default output directory is `site/`. `msdocs` records its generated files
in `.msdocs-manifest.json`. Each build updates recorded files, removes recorded
stale files, preserves unrelated files, and reports unowned path collisions.

The emitted files are ordinary static HTML. The preview server also exposes
canonical extensionless routes for leaf pages and slash routes for indexes:

```text
index.html
guides/index.html
guides/getting-started.html
assets/msdocs.css
assets/msdocs.js
404.html
```

Multi-page sites use a filterable page sidebar. Pages with section headings
also receive an “On this page” outline. A standalone `.ms` document uses the
same typography without reserving space for an empty sidebar.

## Custom MDAST conversion

The standard MDAST conversion defines the built-in HTML mapping. Unknown nodes,
including directives, use an empty default rendering.

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

Presentation is kept out of TypeScript strings:

- `public/page.squirrelly` is the Squirrelly page template;
- `public/assets/msdocs.css` is the responsive theme;
- `public/assets/msdocs.js` provides navigation filtering and the mobile menu;
- `public/404.html` is the preview server's 404 response page.

These files are shipped with the package and copied into each build. The
rendered MDAST body is inserted into the page template as HTML.
