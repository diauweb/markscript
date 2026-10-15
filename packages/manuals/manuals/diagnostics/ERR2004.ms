# ERR2004 — Module resolution failed during bundling

## Problem

Bun could not resolve an import from the MarkScript entry or a source module.
Bun's diagnostic identifies the file with the import, the unresolved specifier, and the source location.

## Fix

Correct the import specifier.
For a package import, add the dependency to the package that contains the file with the import.
For a local import, create or move the module to the path that the file with the import resolves.