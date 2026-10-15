# ERR1202 — Document tree reuses object identity

## Problem

The same MDAST node object appears at multiple child paths, or a node's children contain an ancestor.
The diagnostic path identifies the repeated use. The message gives the first path.
Each location in the document tree must contain a different node object.

## Fix

Construct a new MDAST node for each insertion. Clone the full subtree at each insertion location.
Remove child references to ancestors.