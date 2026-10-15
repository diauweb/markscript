# ERR2101 — Finalized document formatting failed

## Problem

This code has two forms:

- The requested output format is unknown. The accepted names are `markdown`, `mdast`, and `pretty`.
- After the document lifecycle completed, conversion of the finalized MDAST to the selected format failed.

## Fix

For an unknown format, select one of the accepted names.
For a conversion failure, read the formatter cause. Correct the reported document structure or metadata.
Select a format with a data model that represents the document.

A conversion failure occurs after the full document lifetime, including all `onReady` callbacks.