# ERR1103 — Expression returned an unsupported document value

## Problem

An expression or component returned a value outside the supported MarkScript-to-MDAST conversion types.
Supported values include MarkScript elements, MDAST nodes, arrays of supported values, strings, numbers, `false`, `null`, and `undefined`.

MarkScript waits for a promise that is the direct result of a document expression, JSX attribute expression, or component.
A promise inside an array, fragment, resolved component value, or manually constructed value stays unresolved. It causes this error.
Direct MDAST conversion outside a document lifetime also causes this error if it finds an async component.

## Fix

Return a supported document value. Convert domain objects to components or MDAST nodes.
Resolve promises before you put their results in arrays, fragments, or component output.
Return one promise directly from an async component.
For multiple asynchronous values, use `Promise.all`.

Execute async components through a MarkScript document entry.
Use `lowerToRoot` directly only for synchronous values.
Use `false`, `null`, or `undefined` to omit content.