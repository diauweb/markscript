# TUT1002 — Markdown, expressions, and JSX

This basic tutorial covers the source forms that produce a MarkScript document.
Complete [TUT1001](./TUT1001.ms) first so the workspace and command workflow are
ready.

## Source forms

MarkScript accepts six document forms:

| Form           | Purpose                                          |
| -------------- | ------------------------------------------------ |
| Markdown       | Write static prose and document structure        |
| Directives     | Attach inline, flow, or grouped metadata         |
| `{expression}` | Insert the result of a TypeScript expression     |
| Lowercase JSX  | Create a built-in Markdown-shaped node           |
| Uppercase JSX  | Call a typed component function                  |
| `attach()`     | Attach expression-valued data to the next node   |

This tutorial uses Markdown, expressions, and lowercase JSX. Components,
directives and attached data are covered in [TUT1003](./TUT1003.ms).

## Write structure in Markdown

Use Markdown for headings, paragraphs, emphasis, links, lists, quotations, and
code blocks:

```mdx
# Release report

The **production** release completed on schedule.

## Checks

- unit tests
- package build
- deployment verification

See the [release record](./release.json).
```

These constructs produce standard MDAST nodes such as `heading`, `paragraph`,
`strong`, `list`, and `link`.

## Insert TypeScript values

Expressions use TypeScript syntax and project types:

```mdx
export const service = 'accounts'
export const latencyMs = 42
export const healthy = true

# {service} service

Median latency: {latencyMs} ms.

{healthy && <p><strong>Status:</strong> healthy</p>}
```

The runtime normalizes expression results according to the current document
context:

| Value                              | Result                                                |
| ---------------------------------- | ----------------------------------------------------- |
| string or number                   | Text in phrasing content; a paragraph in flow content |
| `null`, `undefined`, or `false`    | No emitted node                                       |
| array or fragment                  | Items flattened in source order                       |
| MarkScript element                 | The element's MDAST node or nodes                     |
| MDAST node or root                 | Validated and inserted in the current context         |
| promise returned by the expression | Awaited before insertion                              |
| `true`                             | Runtime error                                         |
| unsupported object or function     | Runtime error                                         |

Format application objects into a supported value:

```mdx
export const owner = { name: 'Ada', team: 'Platform' }

Owner: {owner.name} ({owner.team})
```

## Load asynchronous content

Return a promise directly from a document expression:

```mdx
import { loadSummary } from './summary.ts'

# Summary

{loadSummary()}
```

`loadSummary()` must resolve to a supported document value. Combine several
asynchronous operations in the imported function and return one promise to the
document expression. The compiler supplies the document-level await. Explicit
top-level `await` is outside the `.ms` source grammar.

## Create Markdown nodes with JSX

Lowercase JSX names map to a fixed set of MDAST constructors:

```mdx
<h2>
  Deployment <em>summary</em>
</h2>

<p>
  Read the{' '}
  <a href="./runbook.md" title="Deployment runbook">
    runbook
  </a>
  .
</p>

<ol start={3}>
  <li>Verify</li>
  <li>Publish</li>
</ol>
```

The complete built-in vocabulary is:

| Group                   | JSX names                                   |
| ----------------------- | ------------------------------------------- |
| Headings and paragraphs | `h1` through `h6`, `p`                      |
| Phrasing                | `em`, `strong`, `a`, `img`, `code`, `br`    |
| Flow                    | `blockquote`, `ul`, `ol`, `li`, `pre`, `hr` |
| Grouping                | fragment `<>...</>`                         |

Attributes follow the MDAST shape. For example, `a` requires `href`, `img`
requires `src` and `alt`, and `ol` accepts a non-negative integer `start`.
The `pre` constructor accepts one `code` child and creates a block code node.

Use the [language handbook](../handbooks/HBK1001.ms) for the complete prop and
lowering reference.

## Keep content in its valid context

MDAST separates flow content, phrasing content, and list content. MarkScript
validates each inserted value against its parent.

Phrasing nodes belong inside paragraphs and headings:

```mdx
<p>
  Current state: <strong>ready</strong>.
</p>
```

Flow nodes belong at the document level or inside a compatible flow container:

```mdx
<>
  <h2>Measurements</h2>
  <p>The median was 42 ms.</p>
</>
```

A heading inside a paragraph violates the content model:

```mdx
This paragraph contains {<h2>A flow heading</h2>}.
```

Other invalid structures include a link inside another link, `li` outside a
list, and `pre` with a child other than one `code` element.

## Inspect the result

Check the source, then render the finalized MDAST:

```sh
bun run markscript check docs/report.ms
bun run markscript run docs/report.ms --format mdast
```

The JSON output shows the exact node types, properties, children, and `data`
fields available to downstream MDAST tools.

## Next

Continue with [Components and directive data](./TUT1003.ms).
