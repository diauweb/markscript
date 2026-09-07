# ERR1104 — Content is invalid in this Markdown context

## Problem

MarkScript represents authored content as a typed MDAST tree. A Markdown or JSX
node appears under a parent with a different content type. The
diagnostic names the node, its current parent context, and the path to the
invalid insertion.

## Common cases

- A flow node appears in phrasing content such as a paragraph or heading.
- A link contains another link.
- A root node appears below another node.
- A list contains a child other than a list item.
- A `pre` node has zero children, multiple children, or a direct child with a
  type other than `code`.
- A `section` or `div` directive element appears in phrasing content.
- A `span` directive element appears in flow content.

## Fix

Use the reported path to locate the parent. Move the reported node to a parent
that accepts its content type, or replace it with a node valid in the current
context named by the diagnostic. Remove nested links, keep a root at the
document entry, place only list items directly inside lists, and give each
`pre` exactly one direct `code` child.
