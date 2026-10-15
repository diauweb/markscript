# ERR1002 — Unsupported Markdown node

## Problem

The source contains a Markdown construct that makes an AST node outside the compiler's supported types.
The diagnostic identifies the node and its source location.

## Fix

Replace the construct with supported Markdown, a MarkScript JSX intrinsic, a directive, or a component.