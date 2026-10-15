# ERR1111 — Attacher directives cannot have labels

## Problem

An inline or leaf directive contains a bracket label.
These forms configure the next compatible node with zero-width values. They cannot contain content.

## Fix

Remove `[...]`. Put the content in the next Markdown or component node.