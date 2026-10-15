# ERR1003 — Invalid top-level await

## Problem

An import or export declaration, document expression, or JSX attribute expression contains explicit top-level `await`.

Module-scope code executes when another module imports the compiled `.ms` module.
MarkScript waits for document expressions and JSX attribute expressions during document rendering.

## Valid: return a promise from a document expression

Return the promise from a document expression. MarkScript resolves each document expression before it converts the value to MDAST:

```mdx
{loadSummary()}
```

## Valid: await inside an async function

Named exports can define async functions. These functions can use `await` inside their bodies:

```mdx
export async function loadSummary() {
  const data = await fetchSummary()
  return <p>{data.title}</p>
}

{loadSummary()}
```

## Invalid: await at module scope

```mdx
export const summary = await fetchSummary()
```

Move this operation into an async function.
Call the function from a document expression or another module API.

## Invalid: explicit await in a document expression

```mdx
{await loadSummary()}
```

Return `loadSummary()` directly. MarkScript waits for the returned promise.

## Invalid: explicit await in a JSX attribute expression

```mdx
<Report summary={await loadSummary()} />
```

Pass `loadSummary()` directly as the attribute value.
MarkScript waits for the returned promise before it calls the component.