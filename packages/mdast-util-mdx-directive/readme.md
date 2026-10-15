# @markscript/mdast-util-mdx-directive

This package is a MarkScript fork of `mdast-util-directive@3.1.0`.
It keeps the upstream static `attributes` record.
It also keeps an ordered `directiveAttributes` list with strings, flags, expressions, and spreads.

## Development

Maintain source in `src/`. The public TypeScript entrypoint defines exported types and module augmentations.
`src/lib/` contains the annotated JavaScript implementation.
The workspace build emits `dist/` JavaScript and `types/` declarations before consumer builds. Git ignores both output directories.

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
bun run check
```

## Upstream documentation

[![Build][build-badge]][build]
[![Coverage][coverage-badge]][coverage]
[![Downloads][downloads-badge]][downloads]
[![Size][size-badge]][size]
[![Sponsors][sponsors-badge]][collective]
[![Backers][backers-badge]][collective]
[![Chat][chat-badge]][chat]

These [mdast][] extensions parse and serialize the [generic directives proposal][prop].
Examples include `:cite[smith04]` and `::youtube[Video of a cat in a box]{v=01ab2cd3efg}`.

## Contents

* [What is this?](#what-is-this)
* [When to use this](#when-to-use-this)
* [Install](#install)
* [Use](#use)
* [API](#api)
  * [`directiveFromMarkdown()`](#directivefrommarkdown)
  * [`directiveToMarkdown(options?)`](#directivetomarkdownoptions)
  * [`ContainerDirective`](#containerdirective)
  * [`Directives`](#directives)
  * [`LeafDirective`](#leafdirective)
  * [`TextDirective`](#textdirective)
  * [`ToMarkdownOptions`](#tomarkdownoptions)
* [HTML](#html)
* [Syntax](#syntax)
* [Syntax tree](#syntax-tree)
  * [Nodes](#nodes)
  * [Mixin](#mixin)
* [Types](#types)
* [Compatibility](#compatibility)
* [Related](#related)
* [Contribute](#contribute)
* [License](#license)

## What is this?

This package has two extensions for Markdown directive syntax in [mdast][].
[`mdast-util-from-markdown`][mdast-util-from-markdown] uses the parser extension to convert directives to a syntax tree.
[`mdast-util-to-markdown`][mdast-util-to-markdown] uses the serializer extension to convert directive nodes to Markdown.

## When to use this

Directives are one of four Markdown extension mechanisms.
Refer to [Extending markdown][extending-markdown] in micromark documentation for alternatives.
Use directives when you control authors, processing tools, and display destinations.
Authors can use a guide to embed a tweet without detailed HTML or JavaScript knowledge.

Directives are less suitable when authors, tools, or destinations are unknown.
Use cases include project or product documentation sites, blog tools, and static site generators.

Use these extensions with `mdast-util-from-markdown` and `mdast-util-to-markdown`.

With `mdast-util-from-markdown`, combine this package with [`micromark-extension-directive`][extension].

Without a syntax tree requirement, use [`micromark`][micromark] directly with `micromark-extension-directive`.

[`remark-directive`][remark-directive] uses these packages. It hides their internal integration to make content transforms easier.

This package processes the syntax tree. Other code defines Markdown-to-HTML conversion and application behavior.
Use it for callouts, citations, styled blocks, forms, embeds, spoilers, or other features.
[Traverse the tree][traversal] to convert directives to the required structures.

## Install

This package uses [ESM only][esm].
In Node.js 16 or later, install it with [npm][]:

```sh
npm install @markscript/mdast-util-mdx-directive
```

In Deno, use [`esm.sh`][esmsh]:

```js
import {directiveFromMarkdown, directiveToMarkdown} from 'https://esm.sh/@markscript/mdast-util-mdx-directive@0.1'
```

In browsers, use [`esm.sh`][esmsh]:

```html
<script type="module">
  import {directiveFromMarkdown, directiveToMarkdown} from 'https://esm.sh/@markscript/mdast-util-mdx-directive@0.1?bundle'
</script>
```

## Use

Create `example.md` with this content:

```markdown
A lovely language know as :abbr[HTML]{title="HyperText Markup Language"}.
```

Create `example.js` with this content:

```js
import fs from 'node:fs/promises'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {toMarkdown} from 'mdast-util-to-markdown'
import {directive} from '@markscript/micromark-extension-mdx-directive'
import {directiveFromMarkdown, directiveToMarkdown} from '@markscript/mdast-util-mdx-directive'

const doc = await fs.readFile('example.md')

const tree = fromMarkdown(doc, {
  extensions: [directive()],
  mdastExtensions: [directiveFromMarkdown()]
})

console.log(tree)

const out = toMarkdown(tree, {extensions: [directiveToMarkdown()]})

console.log(out)
```

Run `node example.js`. The output below omits position information:

```js
{
  type: 'root',
  children: [
    {
      type: 'paragraph',
      children: [
        {type: 'text', value: 'A lovely language know as '},
        {
          type: 'textDirective',
          name: 'abbr',
          attributes: {title: 'HyperText Markup Language'},
          children: [{type: 'text', value: 'HTML'}]
        },
        {type: 'text', value: '.'}
      ]
    }
  ]
}
```

```markdown
A lovely language know as :abbr[HTML]{title="HyperText Markup Language"}.
```

## API

This package exports [`directiveFromMarkdown`][api-directive-from-markdown] and [`directiveToMarkdown`][api-directive-to-markdown].
It has no default export.

### `directiveFromMarkdown()`

Creates a [`mdast-util-from-markdown`][mdast-util-from-markdown] extension for Markdown directives.

###### Returns

Extension for `mdast-util-from-markdown` to enable directives
([`FromMarkdownExtension`][from-markdown-extension]).

### `directiveToMarkdown(options?)`

Creates a [`mdast-util-to-markdown`][mdast-util-to-markdown] extension for Markdown directives.

###### Parameters

* `options`
  ([`ToMarkdownOptions`][api-to-markdown-options], optional)
  — configuration

###### Returns

Extension for `mdast-util-to-markdown` to enable directives
([`ToMarkdownExtension`][to-markdown-extension]).

### `ContainerDirective`

This TypeScript type describes a directive in flow content, such as a root document or blockquote.
The directive contains additional flow content.

###### Type

```ts
import type {BlockContent, DefinitionContent, Parent} from 'mdast'

interface ContainerDirective extends Parent {
  type: 'containerDirective'
  name: string
  attributes?: Record<string, string | null | undefined> | null | undefined
  children: Array<BlockContent | DefinitionContent>
}
```

### `Directives`

This TypeScript type describes the different directive nodes.

###### Type

```ts
type Directives = ContainerDirective | LeafDirective | TextDirective
```

### `LeafDirective`

This TypeScript type describes a directive in flow content, such as a root document or blockquote.
The directive contains no content.

###### Type

```ts
import type {PhrasingContent, Parent} from 'mdast'

interface LeafDirective extends Parent {
  type: 'leafDirective'
  name: string
  attributes?: Record<string, string | null | undefined> | null | undefined
  children: Array<PhrasingContent>
}
```

### `TextDirective`

This TypeScript type describes a directive in phrasing content, such as a paragraph or heading.

###### Type

```ts
import type {PhrasingContent, Parent} from 'mdast'

interface TextDirective extends Parent {
  type: 'textDirective'
  name: string
  attributes?: Record<string, string | null | undefined> | null | undefined
  children: Array<PhrasingContent>
}
```

### `ToMarkdownOptions`

Configuration.

###### Parameters

* `collapseEmptyAttributes` (`boolean`, default: `true`): Collapse empty attributes to `title` instead of `title=""`.
* `preferShortcut` (`boolean`, default: `true`): Use `#` and `.` shortcuts for `id` and `class`.
* `preferUnquoted` (`boolean`, default: `false`): Omit attribute quotes when this makes fewer bytes.
* `quoteSmart` (`boolean`, default: `false`): Use the other quote character when this makes fewer bytes.
* `quote` (`'"'` or `"'"`): Quote character for attribute values.
  The default is the [`quote`][quote] that `mdast-util-to-markdown` uses for titles.

## HTML

Other code defines Markdown-to-HTML conversion and application behavior.
Use this utility for callouts, citations, styled blocks, forms, embeds, spoilers, or other features.
[Traverse the tree][traversal] to convert directives to the required structures.

## Syntax

Refer to [Syntax in `micromark-extension-directive`][syntax].

## Syntax tree

This utility adds these interfaces to **[mdast][]**.

### Nodes

#### `TextDirective`

```idl
interface TextDirective <: Parent {
  type: 'textDirective'
  children: [PhrasingContent]
}

TextDirective includes Directive
```

**TextDirective** (**[Parent][dfn-parent]**) is a directive in **[phrasing][dfn-phrasing-content]** content.
Its content model is also **[phrasing][dfn-phrasing-content]**.
It includes the **[Directive][dfn-mxn-directive]** mixin.

This Markdown:

```markdown
:name[Label]{#x.y.z key=value}
```

Makes:

```js
{
  type: 'textDirective',
  name: 'name',
  attributes: {id: 'x', class: 'y z', key: 'value'},
  children: [{type: 'text', value: 'Label'}]
}
```

#### `LeafDirective`

```idl
interface LeafDirective <: Parent {
  type: 'leafDirective'
  children: [PhrasingContent]
}

LeafDirective includes Directive
```

**LeafDirective** (**[Parent][dfn-parent]**) is a directive in **[flow][dfn-flow-content]** content.
Its content model is **[phrasing][dfn-phrasing-content]**.
It includes the **[Directive][dfn-mxn-directive]** mixin.

This Markdown:

```markdown
::youtube[Label]{v=123}
```

Makes:

```js
{
  type: 'leafDirective',
  name: 'youtube',
  attributes: {v: '123'},
  children: [{type: 'text', value: 'Label'}]
}
```

#### `ContainerDirective`

```idl
interface ContainerDirective <: Parent {
  type: 'containerDirective'
  children: [FlowContent]
}

ContainerDirective includes Directive
```

**ContainerDirective** (**[Parent][dfn-parent]**) is a directive in **[flow][dfn-flow-content]** content.
Its content model is also **[flow][dfn-flow-content]**.
It includes the **[Directive][dfn-mxn-directive]** mixin.

If a label contains phrasing content, the utility inserts it as the first paragraph.
That paragraph has `directiveLabel: true`.

This Markdown:

```markdown
:::spoiler[Open at your own peril]
He dies.
:::
```

Makes:

```js
{
  type: 'containerDirective',
  name: 'spoiler',
  attributes: {},
  children: [
    {
      type: 'paragraph',
      data: {directiveLabel: true},
      children: [{type: 'text', value: 'Open at your own peril'}]
    },
    {
      type: 'paragraph',
      children: [{type: 'text', value: 'He dies.'}]
    }
  ]
}
```

### Mixin

#### `Directive`

```idl
interface mixin Directive {
  name: string
  attributes: Attributes?
}

interface Attributes {}
typedef string AttributeName
typedef string AttributeValue
```

**Directive** represents a construct that an extension defines.

The required `name` field identifies an extension.

The `attributes` field contains node information. Its value implements the **Attributes** interface.

In **Attributes**, each field must be an `AttributeName`. Each value must be an `AttributeValue`.
Fields and values have no fixed HTML or hast semantics.

> In JSON, treat `null` as an absent attribute.
> In JavaScript, ignore both `null` and `undefined`.

## Types

This package gives full [TypeScript][] types.
Additional exports include [`ContainerDirective`][api-container-directive], [`Directives`][api-directives], [`LeafDirective`][api-leaf-directive], and [`TextDirective`][api-text-directive].

The package registers node types with `@types/mdast`.
For syntax tree work, import the utility in your types to register the new node types.

```js
/**
 * @import {} from '@markscript/mdast-util-mdx-directive'
 * @import {Root} from 'mdast'
 */

import {visit} from 'unist-util-visit'

/** @type {Root} */
const tree = getMdastNodeSomeHow()

visit(tree, function (node) {
  // `node` can now be one of the nodes for directives.
})
```

## Compatibility

The unified collective maintains compatibility with supported Node.js versions.

New major releases remove support for unmaintained Node.js versions.
The `mdast-util-directive@^3` release line targets Node.js 16 compatibility.

This utility works with `mdast-util-from-markdown` version 2+ and
`mdast-util-to-markdown` version 2+.

## Related

* [`remarkjs/remark-directive`][remark-directive]
  — remark plugin to support generic directives
* [`micromark/micromark-extension-directive`][extension]
  — micromark extension to parse directives

## Contribute

Refer to [`contributing.md`][contributing] in [`syntax-tree/.github`][health] for contribution instructions.
Refer to [`support.md`][support] for help.

This project has a [code of conduct][coc].
Interaction with the repository, organization, or community indicates agreement to its terms.

## License

[MIT][license] © [Titus Wormer][author]

<!-- Definitions -->

[build-badge]: https://github.com/syntax-tree/mdast-util-directive/workflows/main/badge.svg

[build]: https://github.com/syntax-tree/mdast-util-directive/actions

[coverage-badge]: https://img.shields.io/codecov/c/github/syntax-tree/mdast-util-directive.svg

[coverage]: https://codecov.io/github/syntax-tree/mdast-util-directive

[downloads-badge]: https://img.shields.io/npm/dm/mdast-util-directive.svg

[downloads]: https://www.npmjs.com/package/mdast-util-directive

[size-badge]: https://img.shields.io/badge/dynamic/json?label=minzipped%20size&query=$.size.compressedSize&url=https://deno.bundlejs.com/?q=mdast-util-directive

[size]: https://bundlejs.com/?q=mdast-util-directive

[sponsors-badge]: https://opencollective.com/unified/sponsors/badge.svg

[backers-badge]: https://opencollective.com/unified/backers/badge.svg

[collective]: https://opencollective.com/unified

[chat-badge]: https://img.shields.io/badge/chat-discussions-success.svg

[chat]: https://github.com/syntax-tree/unist/discussions

[npm]: https://docs.npmjs.com/cli/install

[esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[esmsh]: https://esm.sh

[typescript]: https://www.typescriptlang.org

[license]: license

[author]: https://wooorm.com

[health]: https://github.com/syntax-tree/.github

[contributing]: https://github.com/syntax-tree/.github/blob/main/contributing.md

[support]: https://github.com/syntax-tree/.github/blob/main/support.md

[coc]: https://github.com/syntax-tree/.github/blob/main/code-of-conduct.md

[mdast]: https://github.com/syntax-tree/mdast

[mdast-util-from-markdown]: https://github.com/syntax-tree/mdast-util-from-markdown

[mdast-util-to-markdown]: https://github.com/syntax-tree/mdast-util-to-markdown

[quote]: https://github.com/syntax-tree/mdast-util-to-markdown#optionsquote

[micromark]: https://github.com/micromark/micromark

[extension]: https://github.com/micromark/micromark-extension-directive

[syntax]: https://github.com/micromark/micromark-extension-directive#syntax

[remark-directive]: https://github.com/remarkjs/remark-directive

[extending-markdown]: https://github.com/micromark/micromark#extending-markdown

[prop]: https://talk.commonmark.org/t/generic-directives-plugins-syntax/444

[traversal]: https://unifiedjs.com/learn/recipe/tree-traversal/

[dfn-parent]: https://github.com/syntax-tree/mdast#parent

[dfn-flow-content]: https://github.com/syntax-tree/mdast#flowcontent

[dfn-phrasing-content]: https://github.com/syntax-tree/mdast#phrasingcontent

[from-markdown-extension]: https://github.com/syntax-tree/mdast-util-from-markdown#extension

[to-markdown-extension]: https://github.com/syntax-tree/mdast-util-to-markdown#options

[api-directive-from-markdown]: #directivefrommarkdown

[api-directive-to-markdown]: #directivetomarkdownoptions

[api-to-markdown-options]: #tomarkdownoptions

[api-container-directive]: #containerdirective

[api-directives]: #directives

[api-leaf-directive]: #leafdirective

[api-text-directive]: #textdirective

[dfn-mxn-directive]: #directive
