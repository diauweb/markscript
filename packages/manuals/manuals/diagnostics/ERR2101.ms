# ERR2101 — Finalized document formatting failed

## Problem

This code has two forms:

- The requested output format is unknown. The accepted names are `markdown`,
  `mdast`, and `pretty`.
- The document lifecycle completed. Conversion of the finalized MDAST to the
  selected format failed.

## Fix

For an unknown format, select one of the accepted names. For a conversion
failure, read the formatter cause and correct the reported document structure
or metadata. Select a format whose data model represents the document.

A conversion failure occurs after the document lifetime, including all `onReady`
callbacks.
