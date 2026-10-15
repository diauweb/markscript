# ERR2003 — Bundling failed

## Problem

Bun reported a failure in parsing, loading, transformation, or output emission during the build of a MarkScript entry and its source modules.

## Fix

Read Bun's build message. Correct the source at the reported location.
For a failure in a compiled `.ms` module, MarkScript maps the generated JavaScript location to the original MarkScript source.
JavaScript and TypeScript module failures keep Bun's source location.