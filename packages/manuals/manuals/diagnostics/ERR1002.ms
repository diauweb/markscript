# ERR1002 — Unsupported Markdown node

## Problem

The source contains a Markdown construct that produced an AST node unsupported
by the MarkScript compiler. The diagnostic identifies the node and its source
location.

## Fix

Rewrite the construct with supported Markdown, a MarkScript JSX intrinsic, a
directive, or a component.
