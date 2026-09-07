# TUT1003 — Components and directive data

This intermediate tutorial creates reusable document components and attaches
structured metadata to their MDAST output. It builds on the source forms from
[TUT1002](./TUT1002.ms).

## Define a typed component

An uppercase JSX name resolves to an ordinary TypeScript function. Its props
are checked at each call site.

Add this component to `docs/report.ms`:

```mdx
import type {MarkValue} from '@markscript/markscript'

export interface SummaryProps {
  title: string
  state: 'ready' | 'blocked'
  children?: unknown
}

export function Summary(
  {title, state, children}: SummaryProps
): MarkValue {
  return (
    <blockquote>
      <p><strong>{title}</strong>: {state}</p>
      {children}
    </blockquote>
  )
}

# Release report

<Summary title="Package build" state="ready">
  Build artifacts passed verification.
</Summary>
```

The component runs during document rendering. It may return a primitive,
element, fragment, array, MDAST value, or an empty value. TypeScript verifies
the `title` and `state` props before execution.

Use a fragment when a component returns several sibling nodes:

```mdx
export function Section(
  {title, children}: {title: string; children?: unknown}
) {
  return (
    <>
      <h2>{title}</h2>
      {children}
    </>
  )
}
```

## Attach metadata with directives

Directives attach named application data. Markdown supplies inline and flow
attachers plus a flattened flow group:

```mdx
:::callout{tone="warning"}
Review the deployment window.

Confirm the release owner.
:::

::badge{tone=success}

Ready.

The output uses :abbr{title="HyperText Markup Language"}**HTML**.
```

The `:` and `::` forms are zero-width and cannot use bracket labels. They
attach to the next phrasing or flow node. The `:::` form attaches its data to
each directly contained flow node and then disappears completely.

Attributes without inner braces are strings, while bare attributes are `true`.
Use inner braces for TypeScript values, nested objects, and spreads:

```mdx
export const shared = {keepWithNext: true}

::ref{id=summary stability=stable}
::layout{spacing={{after: 120}} {...shared}}

## Summary
```

Both values attach to the heading:

```js
{
  type: 'heading',
  depth: 2,
  children: [{type: 'text', value: 'Summary'}],
  data: {
    ref: {
      id: 'summary',
      stability: 'stable'
    },
    layout: {
      spacing: {after: 120},
      keepWithNext: true
    }
  }
}
```

Directive processing follows four rules:

1. Inline and flow attachers emit no node.
2. Pending attachers target the next compatible emitted node.
3. Consecutive values in one namespace shallow-merge.
4. Groups annotate their emitted children and leave no trace.

Later properties replace earlier properties with the same name:

```mdx
{attach('layout', {spacing: {before: 1, after: 1}})}
{attach('layout', {spacing: {before: 2}})}

Paragraph
```

The final `data.layout.spacing` value is `{before: 2}` because the merge is
shallow.

## Store serializable data

Final metadata accepts scalars, arrays, and plain objects. This shape keeps the
MDAST value portable between serializers and processes.

Convert application objects to plain data before attaching them:

```mdx
export const release = {
  id: '2026.08',
  publishedAt: new Date('2026-08-08T12:00:00Z'),
}

{attach('release', {
  id: release.id,
  publishedAt: release.publishedAt.toISOString(),
})}

# Release 2026.08
```

Final MDAST data accepts scalars, arrays, and plain objects with data
properties. Convert functions, accessors, class instances, maps, sets, dates,
and response objects during the transform lifetime.

## Inspect directive data

Render JSON and query it with `jq`:

```sh
bun run markscript check docs/report.ms
bun run markscript run docs/report.ms --format mdast > build/report.json
jq '.. | objects | select(.data?.ref? != null)' build/report.json
```

In TypeScript, structural selectors work on MDAST properties:

```ts
import { selectAll } from 'unist-util-select'
import { visit } from 'unist-util-visit'

const headings = selectAll('heading[depth=2]', root)

visit(root, (node) => {
  if (node.data?.ref?.tags?.includes('public')) {
    console.error(node.type)
  }
})
```

Use selectors for standard node properties and ordinary traversal for
application data stored under `node.data`.

## Next

Continue with [TypeScript projects, imports, and editor setup](./TUT1004.ms).
