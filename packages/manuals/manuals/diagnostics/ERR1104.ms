# ERR1104 — Content is invalid in this Markdown context

## Problem

MarkScript represents authored content as a typed MDAST tree.
A Markdown or JSX node has a parent with an incompatible content type.
The diagnostic identifies the node, its current parent context, and the path to the invalid insertion.

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

Use the reported path to find the parent.
Move the node to a parent that accepts its content type.
Alternatively, replace it with a node that is valid in the reported context.

Remove nested links. Keep a root at the document entry.
Put only list items directly inside lists. Give each `pre` exactly one direct `code` child.