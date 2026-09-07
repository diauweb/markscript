# ERR1103 — Expression returned an unsupported document value

## Problem

An expression or component returned a value outside the MarkScript-to-MDAST
conversion vocabulary.
Supported values are MarkScript elements, MDAST nodes, arrays of supported
values, strings, numbers, `false`, `null`, and `undefined`.

MarkScript awaits a promise when it is the direct result of a document
expression, JSX attribute expression, or component. A promise inside an array,
fragment, resolved component value, or manually constructed value remains
unresolved and reports this error. Direct MDAST lowering outside a document
lifetime also reports this error when it encounters an async component.

## Fix

Return a supported document value. Convert domain objects to components or
MDAST nodes. Resolve promises before placing their results in arrays,
fragments, or component output. Return one promise directly from an async
component, or use `Promise.all` when producing several asynchronous values.
Execute async components through a MarkScript document entry rather than by
calling `lowerToRoot` directly. Use `false`, `null`, or `undefined` to omit
content.
