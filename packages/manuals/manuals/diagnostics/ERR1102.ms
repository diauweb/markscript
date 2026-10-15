# ERR1102 — JSX arguments are invalid

## Problem

An intrinsic, fragment, or component received one of these invalid arguments:

- An unsupported attribute or an invalid attribute value.
- Invalid props.
- Children in an element that accepts none.
- A JSX key.

## Fix

Use the element's declared props exactly. Remove unsupported attributes and keys.
Give required values with the documented type. Remove children from void elements.

Directive attributes without inner braces are strings.
Use `{expression}` for TypeScript values. Use `{{...}}` for object literals.