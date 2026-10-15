# @markscript/micromark-extension-mdx-directive

This package is a MarkScript fork of `micromark-extension-directive@4.0.0`.
It keeps the upstream directive tokenizer.
The MDX expression factory adds JSX `{expression}` attribute values and `{...spread}` attributes.

## Development

Maintain source in `src/`. The public TypeScript entrypoint defines exported types and module augmentations.
`src/lib/` contains the annotated JavaScript implementation.
The tokenizer uses upstream `dev/lib/`, with named character constants and development assertions.
The workspace build emits `dist/` JavaScript and `types/` declarations before consumer builds. Git ignores both directories.

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

These [micromark][] extensions support [directives][prop], such as `:cite[smith04]`.

## Contents

* [What is this?](#what-is-this)
* [When to use this](#when-to-use-this)
* [Install](#install)
* [Use](#use)
* [API](#api)
  * [`directive()`](#directive)
  * [`directiveHtml(options?)`](#directivehtmloptions)
  * [`Directive`](#directive-1)
  * [`Handle`](#handle)
  * [`HtmlOptions`](#htmloptions)
* [Authoring](#authoring)
* [HTML](#html)
* [CSS](#css)
* [Syntax](#syntax)
* [Compatibility](#compatibility)
* [Security](#security)
* [Related](#related)
* [Contribute](#contribute)
* [License](#license)

## What is this?

This package gives two [`micromark`][micromark] extensions for Markdown directive syntax.

## When to use this

Use this project for one Markdown syntax that supports any number of extensions.

Use these extensions with [`micromark`][micromark].

For a syntax tree, combine this package with [`mdast-util-directive`][mdast-util-directive].

[`remark-directive`][remark-directive] uses these packages. It hides their internal integration to make content transforms easier.

## Install

This package uses [ESM only][esm].
In Node.js 16 or later, install it with [npm][]:

Use [npm][]:

```sh
npm install @markscript/micromark-extension-mdx-directive
```

In Deno, use [`esm.sh`][esmsh]:

```js
import {directive, directiveHtml} from 'https://esm.sh/@markscript/micromark-extension-mdx-directive@0.1'
```

In browsers, use [`esm.sh`][esmsh]:

```html
<script type="module">
  import {directive, directiveHtml} from 'https://esm.sh/@markscript/micromark-extension-mdx-directive@0.1?bundle'
</script>
```

## Use

Create `example.md` with this content:

```markdown
A lovely language know as :abbr[HTML]{title="HyperText Markup Language"}.
```

Create `example.js` with this content:

```js
/**
 * @import {Handle} from '@markscript/micromark-extension-mdx-directive'
 * @import {CompileContext} from 'micromark-util-types'
 */

import fs from 'node:fs/promises'
import {micromark} from 'micromark'
import {directive, directiveHtml} from '@markscript/micromark-extension-mdx-directive'

const output = micromark(await fs.readFile('example.md'), {
  extensions: [directive()],
  htmlExtensions: [directiveHtml({abbr})]
})

console.log(output)

/**
 * @this {CompileContext}
 * @type {Handle}
 * @returns {false | undefined}
 */
function abbr(d) {
  if (d.type !== 'textDirective') return false

  this.tag('<abbr')

  if (d.attributes && 'title' in d.attributes) {
    this.tag(' title="' + this.encode(d.attributes.title) + '"')
  }

  this.tag('>')
  this.raw(d.label || '')
  this.tag('</abbr>')
}
```

Run `node example.js` to make:

```html
<p>A lovely language know as <abbr title="HyperText Markup Language">HTML</abbr>.</p>
```

## API

This package exports [`directive`][api-directive] and [`directiveHtml`][api-directive-html]. It has no default export.
It also exports [TypeScript][] types [`Directive`][api-directive-type], [`Handle`][api-handle], and [`HtmlOptions`][api-html-options].

The export map supports the [`development` condition][development].
Run `node --conditions development module.js` for instrumented development code.
Without this condition, the loader selects production code.

### `directive()`

Creates a `micromark` extension for directive syntax.

###### Returns

Returns an [`Extension`][micromark-extension] for directive syntax. Pass it in `extensions`.

### `directiveHtml(options?)`

Creates a `micromark` extension for directive serialization to HTML.

> **Note:** This uses KaTeX for math rendering.

###### Parameters

* `options`
  ([`HtmlOptions`][api-html-options], default: `{}`)
  — configuration

###### Returns

Returns an [`HtmlExtension`][micromark-html-extension] for directive serialization to HTML. Pass it in `htmlExtensions`.

### `Directive`

This TypeScript type describes a directive structure.

###### Fields

* `type` (`'containerDirective'`, `'leafDirective'`, or `'textDirective'`): Directive kind.
* `name` (`string`): Directive name.
* `label` (`string` or `undefined`): Compiled HTML from `[brackets]`.
* `attributes` (`Record<string, string>` or `undefined`): Object with HTML attributes.
* `content` (`string` or `undefined`): Compiled HTML inside a container directive.

### `Handle`

This TypeScript function type processes a directive.

###### Parameters

* `this` ([`CompileContext`][micromark-compile-context])
  — current context
* `directive` ([`Directive`][api-directive-type])
  — directive

###### Returns

Returns a `boolean` that indicates directive handling success. The default is `true`.
Return `false` to use the fallback handler for `'*'`.

### `HtmlOptions`

Configuration (TypeScript type).

> **Note:** The `'*'` field specifies a fallback handler for directives without a specific handler.

###### Type

```ts
type HtmlOptions = Record<string, Handle>
```

## Authoring

Most Markdown tools do not support directives. Use them on sites where you control the parser and renderer.

## HTML

Define how directives convert to HTML. A directive without a handler emits no content.

## CSS

Define the CSS presentation for your directives.

## Syntax

The syntax looks like this:

```markdown
Directives in text can form with a single colon,
such as :cite[smith04].
Their syntax is `:name[label]{attributes}`.

Leafs (block without content) can form by using two colons:

::youtube[Video of a cat in a box]{vid=01ab2cd3efg}

Their syntax is `::name[label]{attributes}` on its own line.

Containers (blocks with content) can form by using three colons:

:::spoiler
He dies.
:::

The `name` part is required.
The first character must be a letter,
other characters can be alphanumerical, `-`, and `_`.
`-` or `_` cannot end a name.

The `[label]` part is optional (`:x` and `:x[]` are equivalent)†.
When used,
it can include text constructs such as emphasis and so on: `x[a *b* c]`.

The `{attributes}` part is optional (`:x` and `:x{}` are equivalent)†.
When used,
it is handled like HTML attributes, such as that `{a}`, `{a=""}`, and `{a=''}`
but also `{a=b}`, `{a="b"}`, and `{a='b'}` are equivalent.
Shortcuts are available for `id=` (`{#readme}` for `{id=readme}`) and
`class` (`{.big}` for `{class=big}`).
When multiple ids are found,
the last is used; when multiple classes are found,
they are combined:
`{.red class=green .blue}` is equivalent to
`{.red .green .blue}` and `{class="red green blue"}`.

† there is one case where a name must be followed by an empty label or empty
attributes:
a *text* directive that only has a name,
cannot be followed by a colon.
So,
`:red:` doesn’t work.
Use either `:red[]` or `:red{}` instead.
The reason for this is to allow GitHub emoji (gemoji) and directives to coexist.

Containers can be nested by using more colons outside:

::::spoiler
He dies.

:::spoiler
She is born.
:::
::::

The closing fence must include the same or more colons as the opening.
If no closing is found,
the container runs to the end of its parent container
(block quote, list item, document, or other container).

::::spoiler
These three are not enough to close
:::
So this line is also part of the container.
```

This implementation uses CommonMark rules closely. Other implementations can accept different syntax:

* Colons, names, labels, and attributes must be adjacent.
  Spaces are invalid in ~~`: a`~~, ~~`:a []`~~, ~~`:a {}`~~, and ~~`:a[] {}`~~, as in links (~~`[] ()`~~).
* A container opening fence cannot have trailing colons (~~`:::a:::`~~), as with code fences.
* A leaf or container label and attributes cannot include line endings (~~`::a[b
c]`~~), as with code fences.

## Compatibility

The unified collective maintains compatibility with supported Node.js versions.

New major releases remove support for unmaintained Node.js versions.
The `micromark-extension-directive@4` release line targets Node.js 16 compatibility.

This package works with `micromark` version `4` and later.

## Security

Use safe handlers with this package.
A handler vulnerability can permit a [cross-site scripting (XSS)][xss] attack.

## Related

* [`remark-directive`][remark-directive]
  — remark plugin to support directives
* [`mdast-util-directive`][mdast-util-directive]
  — mdast utility to support directives

## Contribute

Refer to [`contributing.md` in `micromark/.github`][contributing] for contribution instructions.
Refer to [`support.md`][support] for help.

This project has a [code of conduct][coc].
Interaction with the repository, organization, or community indicates agreement to its terms.

## License

[MIT][license] © [Titus Wormer][author]

<!-- Definitions -->

[api-directive]: #directive

[api-directive-html]: #directivehtmloptions

[api-directive-type]: #directive-1

[api-handle]: #handle

[api-html-options]: #htmloptions

[author]: https://wooorm.com

[backers-badge]: https://opencollective.com/unified/backers/badge.svg

[build]: https://github.com/micromark/micromark-extension-directive/actions

[build-badge]: https://github.com/micromark/micromark-extension-directive/workflows/main/badge.svg

[chat]: https://github.com/micromark/micromark/discussions

[chat-badge]: https://img.shields.io/badge/chat-discussions-success.svg

[coc]: https://github.com/micromark/.github/blob/main/code-of-conduct.md

[collective]: https://opencollective.com/unified

[contributing]: https://github.com/micromark/.github/blob/main/contributing.md

[coverage]: https://codecov.io/github/micromark/micromark-extension-directive

[coverage-badge]: https://img.shields.io/codecov/c/github/micromark/micromark-extension-directive.svg

[development]: https://nodejs.org/api/packages.html#packages_resolving_user_conditions

[downloads]: https://www.npmjs.com/package/micromark-extension-directive

[downloads-badge]: https://img.shields.io/npm/dm/micromark-extension-directive.svg

[esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[esmsh]: https://esm.sh

[license]: license

[mdast-util-directive]: https://github.com/syntax-tree/mdast-util-directive

[micromark]: https://github.com/micromark/micromark

[micromark-compile-context]: https://github.com/micromark/micromark/blob/41e3c4c/packages/micromark-util-types/index.js#L457

[micromark-extension]: https://github.com/micromark/micromark#syntaxextension

[micromark-html-extension]: https://github.com/micromark/micromark#htmlextension

[npm]: https://docs.npmjs.com/cli/install

[prop]: https://talk.commonmark.org/t/generic-directives-plugins-syntax/444

[remark-directive]: https://github.com/remarkjs/remark-directive

[size]: https://bundlejs.com/?q=micromark-extension-directive

[size-badge]: https://img.shields.io/badge/dynamic/json?label=minzipped%20size&query=$.size.compressedSize&url=https://deno.bundlejs.com/?q=micromark-extension-directive

[sponsors-badge]: https://opencollective.com/unified/sponsors/badge.svg

[support]: https://github.com/micromark/.github/blob/main/support.md

[typescript]: https://www.typescriptlang.org

[xss]: https://en.wikipedia.org/wiki/Cross-site_scripting
