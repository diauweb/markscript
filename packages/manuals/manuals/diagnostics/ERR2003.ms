# ERR2003 — Bundling failed

## Problem

Bun reported a parsing, loading, transformation, or output-emission failure
while building the MarkScript entry and its source modules.

## Fix

Read Bun's build message and correct the source at the reported location.
For a failure in a compiled `.ms` module, MarkScript maps the generated
JavaScript location back to the original MarkScript source. Failures in
JavaScript and TypeScript modules retain Bun's source location.
