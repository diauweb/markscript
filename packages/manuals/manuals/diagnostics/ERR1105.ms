# ERR1105 — Directive attachment failed

## Problem

A directive attachment failed for one of these reasons:

- Its namespace is empty.
- Its document sequence ends before a compatible node.
- Its namespace conflicts with an existing non-object value in `node.data`.
- A directive group contains no compatible nodes.
- Its target node or data is immutable.

## Fix

Use `:search{indexed=true}` before a phrasing node or
`::search{indexed=true}` before a flow node. Keep it in the same local sequence
as its target. Keep the target node and `node.data` mutable during lowering.
Any existing value at the matching `node.data` namespace must be a plain object.
