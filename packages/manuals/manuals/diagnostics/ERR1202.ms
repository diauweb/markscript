# ERR1202 — Document tree reuses object identity

## Problem

The same MDAST node object appears at more than one child path, or a node's
children contain one of its ancestors. The diagnostic path identifies the
repeated use, and the message reports the first path. Each location in the
document tree must contain a distinct node object.

## Fix

Construct a fresh MDAST node for every insertion. Clone the complete reused
subtree for each location. Remove child references that point to an ancestor.
