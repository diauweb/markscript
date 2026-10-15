# @markscript/remark-mdx-directive

This package is a MarkScript fork of `remark-directive@4.0.0`.
It combines the scoped micromark and MDAST forks.
It passes MDX expression-parser options from the MarkScript compiler to those forks.

## Development

Maintain source in `src/`. The public TypeScript entrypoint defines exported types and module augmentations.
`src/lib/` contains the annotated JavaScript implementation.
The workspace build emits `dist/` JavaScript and `types/` declarations before consumer builds. Git ignores both directories.

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
bun run check
```

## Upstream documentation

[![Build][badge-build-image]][badge-build-url]
[![Coverage][badge-coverage-image]][badge-coverage-url]
[![Downloads][badge-downloads-image]][badge-downloads-url]
[![Size][badge-size-image]][badge-size-url]

This **[remark][github-remark]** plugin supports the [generic directives proposal][commonmark-directive-proposal].
Examples include `:cite[smith04]` and `::youtube[Video of a cat in a box]{v=01ab2cd3efg}`.

## Contents

* [What is this?](#what-is-this)
* [When should I use this?](#when-should-i-use-this)
* [Install](#install)
* [Use](#use)
* [API](#api)
  * [`unified().use(remarkDirective[, options])`](#unifieduseremarkdirective-options)
  * [`Options`](#options)
* [Examples](#examples)
  * [Example: YouTube](#example-youtube)
  * [Example: Styled blocks](#example-styled-blocks)
* [Authoring](#authoring)
* [HTML](#html)
* [CSS](#css)
* [Syntax](#syntax)
* [Syntax tree](#syntax-tree)
* [Types](#types)
* [Compatibility](#compatibility)
* [Security](#security)
* [Related](#related)
* [Contribute](#contribute)
* [License](#license)

## What is this?

This [unified][github-unified] ([remark][github-remark]) plugin adds directive support.
Directives give one syntax for any Markdown extensions.

## When should I use this?

Directives are one of four Markdown extension mechanisms.
Refer to [Extending markdown][github-micromark-extending-markdown] in micromark documentation for alternatives.
Use directives when you control authors, processing tools, and display destinations.
Authors can use a guide to embed a tweet without detailed HTML or JavaScript knowledge.

Directives are less suitable when authors, tools, or destinations are unknown.
Use cases include project or product documentation sites, blog tools, and static site generators.

For direct Markdown-to-HTML conversion, use [`micromark`][github-micromark] with [`micromark-extension-directive`][github-micromark-extension-directive].
For syntax tree access without plugins, use [`mdast-util-from-markdown`][github-mdast-util-from-markdown] with [`mdast-util-directive`][github-mdast-util-directive].

## Install

This package uses [ESM only][github-gist-esm].
In Node.js 16 or later, install it with [npm][npmjs-install]:

```sh
npm install @markscript/remark-mdx-directive
```

In Deno, use [`esm.sh`][esmsh]:

```js
import remarkDirective from 'https://esm.sh/@markscript/remark-mdx-directive@0.1'
```

In browsers, use [`esm.sh`][esmsh]:

```html
<script type="module">
  import remarkDirective from 'https://esm.sh/@markscript/remark-mdx-directive@0.1?bundle'
</script>
```

## Use

Create `example.md` with this content:

```markdown
:::main{#readme}

Lorem:br
ipsum.

::hr{.red}

A :i[lovely] language know as :abbr[HTML]{title="HyperText Markup Language"}.

:::
```

Create `example.js` with this content:

```js
/**
 * @import {} from 'mdast-util-directive'
 * @import {} from 'mdast-util-to-hast'
 * @import {Root} from 'mdast'
 */

import {h} from 'hastscript'
import rehypeFormat from 'rehype-format'
import rehypeStringify from 'rehype-stringify'
import remarkDirective from '@markscript/remark-mdx-directive'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {read} from 'to-vfile'
import {unified} from 'unified'
import {visit} from 'unist-util-visit'

const file = await unified()
  .use(remarkParse)
  .use(remarkDirective)
  .use(myRemarkPlugin)
  .use(remarkRehype)
  .use(rehypeFormat)
  .use(rehypeStringify)
  .process(await read('example.md'))

console.log(String(file))

// This plugin is an example to let users write HTML with directives.
// It’s informative but rather useless.
// See below for others examples.
function myRemarkPlugin() {
  /**
   * @param {Root} tree
   *   Tree.
   * @returns {undefined}
   *   Nothing.
   */
  return function (tree) {
    visit(tree, function (node) {
      if (
        node.type === 'containerDirective' ||
        node.type === 'leafDirective' ||
        node.type === 'textDirective'
      ) {
        const data = node.data || (node.data = {})
        const hast = h(node.name, node.attributes || {})

        data.hName = hast.tagName
        data.hProperties = hast.properties
      }
    })
  }
}
```

Run `node example.js` to make:

```html
<main id="readme">
  <p>Lorem<br>ipsum.</p>
  <hr class="red">
  <p>A <i>lovely</i> language know as <abbr title="HyperText Markup Language">HTML</abbr>.</p>
</main>
```

## API

The default export is [`remarkDirective`][api-remark-directive]. This package has no named exports.

### `unified().use(remarkDirective[, options])`

Adds support for generic directives.

###### Parameters

* `options`
  ([`Options`][api-options], optional)
  — configuration

###### Returns

Nothing (`undefined`).

###### Notes

The plugin adds syntax support.
To process directives, [create your own plugin][unifiedjs-create-remark-plugin].

### `Options`

Configuration (TypeScript type).

###### Fields

* `collapseEmptyAttributes` (`boolean`, default: `true`): Collapse empty attributes to `title` instead of `title=""`.
* `preferShortcut` (`boolean`, default: `true`): Use `#` and `.` shortcuts for `id` and `class`.
* `preferUnquoted` (`boolean`, default: `false`): Omit attribute quotes when this makes fewer bytes.
* `quoteSmart` (`boolean`, default: `false`): Use the other quote character when this makes fewer bytes.
* `quote` (`'"'` or `"'"`): Quote character for attribute values.
  The default is the [`quote`][github-remark-stringify-quote] that `remark-stringify` uses for titles.

## Examples

### Example: YouTube

This example uses directives for YouTube embeds. It uses the example in Use.
Replace `myRemarkPlugin` with this function:

```js
/**
 * @import {} from 'mdast-util-directive'
 * @import {} from 'mdast-util-to-hast'
 * @import {Root} from 'mdast'
 * @import {VFile} from 'vfile'
 */

import {visit} from 'unist-util-visit'

// This plugin is an example to turn `::youtube` into iframes.
function myRemarkPlugin() {
  /**
   * @param {Root} tree
   *   Tree.
   * @param {VFile} file
   *   File.
   * @returns {undefined}
   *   Nothing.
   */
  return (tree, file) => {
    visit(tree, function (node) {
      if (
        node.type === 'containerDirective' ||
        node.type === 'leafDirective' ||
        node.type === 'textDirective'
      ) {
        if (node.name !== 'youtube') return

        const data = node.data || (node.data = {})
        const attributes = node.attributes || {}
        const id = attributes.id

        if (node.type === 'textDirective') {
          file.fail(
            'Unexpected `:youtube` text directive, use two colons for a leaf directive',
            node
          )
        }

        if (!id) {
          file.fail('Unexpected missing `id` on `youtube` directive', node)
        }

        data.hName = 'iframe'
        data.hProperties = {
          src: 'https://www.youtube.com/embed/' + id,
          width: 200,
          height: 200,
          frameBorder: 0,
          allow: 'picture-in-picture',
          allowFullScreen: true
        }
      }
    })
  }
}
```

Put this content in `example.md`:

```markdown
# Cat videos

::youtube[Video of a cat in a box]{#01ab2cd3efg}
```

Run `node example.js` to make:

```html
<h1>Cat videos</h1>
<iframe src="https://www.youtube.com/embed/01ab2cd3efg" width="200" height="200" frameborder="0" allow="picture-in-picture" allowfullscreen>Video of a cat in a box</iframe>
```

### Example: Styled blocks

> **Note:** These blocks also have names such as admonitions or callouts.

This example uses directives to style blocks. It uses the example in Use.
Replace `myRemarkPlugin` with this function:

```js
/**
 * @import {} from 'mdast-util-directive'
 * @import {} from 'mdast-util-to-hast'
 * @import {Root} from 'mdast'
 */

import {h} from 'hastscript'
import {visit} from 'unist-util-visit'

// This plugin is an example to turn `::note` into divs,
// passing arbitrary attributes.
function myRemarkPlugin() {
  /**
   * @param {Root} tree
   *   Tree.
   * @returns {undefined}
   *   Nothing.
   */
  return (tree) => {
    visit(tree, (node) => {
      if (
        node.type === 'containerDirective' ||
        node.type === 'leafDirective' ||
        node.type === 'textDirective'
      ) {
        if (node.name !== 'note') return

        const data = node.data || (node.data = {})
        const tagName = node.type === 'textDirective' ? 'span' : 'div'

        data.hName = tagName
        data.hProperties = h(tagName, node.attributes || {}).properties
      }
    })
  }
}
```

Put this content in `example.md`:

```markdown
# How to use xxx

You can use xxx.

:::note{.warning}
if you chose xxx, you should also use yyy somewhere…
:::
```

Run `node example` to make:

```html
<h1>How to use xxx</h1>
<p>You can use xxx.</p>
<div class="warning">
  <p>if you chose xxx, you should also use yyy somewhere…</p>
</div>
```

## Authoring

Most Markdown tools do not support directives. Use them on sites where you control the parser and renderer.

## HTML

Define how directives convert to HTML. A directive without a handler emits no content.

## CSS

Define the CSS presentation for your directives.

## Syntax

Refer to [*Syntax* in `micromark-extension-directive`](https://github.com/micromark/micromark-extension-directive#syntax).

## Syntax tree

Refer to [*Syntax tree* in `mdast-util-directive`](https://github.com/syntax-tree/mdast-util-directive#syntax-tree).

## Types

This package gives full [TypeScript][] types. It exports no additional options.

For syntax tree work, register the new types with `@types/mdast`. Add this reference:

```js
/**
 * @import {} from 'mdast-util-directive'
 * @import {Root} from 'mdast'
 */

import {visit} from 'unist-util-visit'

function myRemarkPlugin() {
  /**
   * @param {Root} tree
   *   Tree.
   * @returns {undefined}
   *   Nothing.
   */
  return (tree) => {
    visit(tree, function (node) {
      console.log(node) // `node` can now be one of the nodes for directives.
    })
  }
}
```

## Compatibility

The unified collective maintains compatibility with supported Node.js versions.

New major releases remove support for unmaintained Node.js versions.
The `remark-directive@3` release line targets Node.js 16 compatibility.

## Security

`remark-directive` uses neither **[rehype][github-rehype]** ([hast][github-hast]) nor user content.
It thus gives no entry point for [cross-site scripting (XSS)][wikipedia-xss] attacks.

## Related

* [`remark-gfm`](https://github.com/remarkjs/remark-gfm)
  — support GFM
  (autolink literals, footnotes, strikethrough, tables, tasklists)
* [`remark-frontmatter`](https://github.com/remarkjs/remark-frontmatter)
  — support frontmatter
  (YAML, TOML, and more)
* [`remark-math`](https://github.com/remarkjs/remark-math)
  — support math
* [`remark-mdx`](https://github.com/mdx-js/mdx/tree/main/packages/remark-mdx)
  — support MDX
  (ESM, JSX, expressions)

## Contribute

Refer to [`contributing.md`][health-contributing] in [`remarkjs/.github`][health] for contribution instructions.
Refer to [`support.md`][health-support] for help.

This project has a [code of conduct][health-coc].
Interaction with the repository, organization, or community indicates agreement to its terms.

## License

[MIT][file-license] © [Titus Wormer][wooorm]

<!-- Definitions -->

[api-options]: #options

[api-remark-directive]: #unifieduseremarkdirective-options

[badge-build-image]: https://github.com/remarkjs/remark-directive/workflows/main/badge.svg

[badge-build-url]: https://github.com/remarkjs/remark-directive/actions

[badge-coverage-image]: https://img.shields.io/codecov/c/github/remarkjs/remark-directive.svg

[badge-coverage-url]: https://codecov.io/github/remarkjs/remark-directive

[badge-downloads-image]: https://img.shields.io/npm/dm/remark-directive.svg

[badge-downloads-url]: https://www.npmjs.com/package/remark-directive

[badge-size-image]: https://img.shields.io/bundlejs/size/remark-directive

[badge-size-url]: https://bundlejs.com/?q=remark-directive

[commonmark-directive-proposal]: https://talk.commonmark.org/t/generic-directives-plugins-syntax/444

[esmsh]: https://esm.sh

[file-license]: license

[github-gist-esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[github-hast]: https://github.com/syntax-tree/hast

[github-mdast-util-directive]: https://github.com/syntax-tree/mdast-util-directive

[github-mdast-util-from-markdown]: https://github.com/syntax-tree/mdast-util-from-markdown

[github-micromark]: https://github.com/micromark/micromark

[github-micromark-extending-markdown]: https://github.com/micromark/micromark#extending-markdown

[github-micromark-extension-directive]: https://github.com/micromark/micromark-extension-directive

[github-rehype]: https://github.com/rehypejs/rehype

[github-remark]: https://github.com/remarkjs/remark

[github-remark-stringify-quote]: https://github.com/remarkjs/remark/tree/main/packages/remark-stringify#options

[github-unified]: https://github.com/unifiedjs/unified

[health]: https://github.com/remarkjs/.github

[health-coc]: https://github.com/remarkjs/.github/blob/main/code-of-conduct.md

[health-contributing]: https://github.com/remarkjs/.github/blob/main/contributing.md

[health-support]: https://github.com/remarkjs/.github/blob/main/support.md

[npmjs-install]: https://docs.npmjs.com/cli/install

[typescript]: https://www.typescriptlang.org

[unifiedjs-create-remark-plugin]: https://unifiedjs.com/learn/guide/create-a-remark-plugin/

[wikipedia-xss]: https://en.wikipedia.org/wiki/Cross-site_scripting

[wooorm]: https://wooorm.com
