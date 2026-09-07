# ERR1111 — Attacher directives cannot have labels

## Problem

An inline or leaf directive contains a bracket label. These forms configure
the next compatible node as zero-width values and cannot own content.

## Fix

Remove `[...]` and place the intended content in the following Markdown or
component node.
