# ERR1105 — Directive attachment failed

## Problem

A directive attachment failed for one of these causes:

- Its namespace is empty.
- Its document sequence ends before a compatible node.
- Its namespace conflicts with an existing non-object value in `node.data`.
- A directive group contains no compatible nodes.
- Its target node or data is immutable.

## Fix

Use `:search{indexed=true}` before a phrasing node. Use `::search{indexed=true}` before a flow node.
Keep the directive in the same local sequence as its target.
Keep the target node and `node.data` mutable during MDAST conversion.
Any existing value in the applicable `node.data` namespace must be a plain object.