# ERR1201 — Document tree violates the MarkScript contract

## Problem

This code reports one of these contract violations:

- The completed document has a node type other than root, or an inserted value is outside the supported MDAST types.
- A node has an unknown type or an invalid, missing, or forbidden field. The reported path identifies the field.
- Final document data contains a function, accessor property, or non-plain object outside the deeply read-only data model.
- A `.ms` source declares a default export. MarkScript reserves this export for the generated document entry.

## Fix

Return an MDAST root. Correct the node or field at the reported path.
Store document metadata in plain objects and arrays with scalar data properties.
full document changes in `onTransform` callbacks before final validation and freezing.
Change source-level default exports to named exports.