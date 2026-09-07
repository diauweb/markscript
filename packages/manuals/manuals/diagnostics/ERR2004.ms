# ERR2004 — Module resolution failed during bundling

## Problem

Bun failed to resolve an import from the MarkScript entry or one of its source
modules. Use the importing file, unresolved specifier, and source location from
Bun's diagnostic to locate the import.

## Fix

Correct the import specifier. For a package import, add the dependency to the
package that contains the importing file. For a local import, create or move the
referenced module to the path resolved from the importing file.
