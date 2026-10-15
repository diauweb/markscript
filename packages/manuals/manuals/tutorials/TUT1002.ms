# TUT1002 — Markdown, expressions, and JSX

This basic tutorial covers source forms that make MarkScript documents.
First, complete [TUT1001](./TUT1001.ms) to prepare the workspace and commands.

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

This tutorial uses Markdown, expressions, and lowercase JSX.
[TUT1003](./TUT1003.ms) covers components, directives, and attached data.

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

These constructs make standard MDAST nodes such as `heading`, `paragraph`,
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

The runtime normalizes expression results with the current document context:

| Value | Result |
|---|---|
| String or number | Text in phrasing content. A paragraph in flow content |
| `null`, `undefined`, or `false` | No emitted node |
| Array or fragment | Flattened items in source order |
| MarkScript element | The element's MDAST nodes |
| MDAST node or root | Validation and insertion in the current context |
| Direct expression promise | Promise resolution before insertion |
| `true` | Runtime error |
| Unsupported object or function | Runtime error |

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

`loadSummary()` must resolve to a supported document value.
Combine asynchronous operations in the imported function. Return one promise to the document expression.
The compiler gives document-level await. The `.ms` source grammar excludes explicit top-level `await`.

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

The full built-in vocabulary is:

| Group                   | JSX names                                   |
| ----------------------- | ------------------------------------------- |
| Headings and paragraphs | `h1` through `h6`, `p`                      |
| Phrasing                | `em`, `strong`, `a`, `img`, `code`, `br`    |
| Flow                    | `blockquote`, `ul`, `ol`, `li`, `pre`, `hr` |
| Grouping                | fragment `<>...</>`                         |

Attributes use MDAST structures. `a` must have `href`. `img` must have `src` and `alt`.
`ol` accepts a non-negative integer `start`.
`pre` accepts one `code` child and creates a block code node.

Refer to the [language handbook](../handbooks/HBK1001.ms) for full prop and MDAST conversion rules.

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

Other invalid structures include a nested link, `li` outside a list, and `pre` without exactly one direct `code` child.

## Examine the result

Check the source. Then render finalized MDAST:

```sh
bun run markscript check docs/report.ms
bun run markscript run docs/report.ms --format mdast
```

The JSON output shows the exact node types, properties, children, and `data`
fields available to downstream MDAST tools.

## Next

Continue with [Components and directive data](./TUT1003.ms).
