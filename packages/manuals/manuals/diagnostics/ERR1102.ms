# ERR1102 — JSX arguments are invalid

## Problem

An intrinsic, fragment, or component received an
unsupported attribute, an invalid attribute value, invalid props, children
where none are allowed, or a JSX key.

## Fix

Match the element's declared props exactly. Remove unsupported attributes and
keys, supply required values with the documented type, and remove children
from void elements. Directive attributes without inner braces are strings;
use `{expression}` for TypeScript values and `{{...}}` for object literals.
