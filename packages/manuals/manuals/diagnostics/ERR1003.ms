# ERR1003 — Invalid top-level await

## Problem

An import/export declaration, document expression, or JSX attribute expression
contains explicit top-level `await`.

Module scope runs when the compiled `.ms` module is imported. MarkScript awaits
document expressions and JSX attribute expressions during document rendering.

## Valid: return a promise from a document expression

Return the promise from a document expression. MarkScript resolves each
document expression before lowering its value:

```mdx
{loadSummary()}
```

## Valid: await inside an async function

Named exports may define async functions and use `await` inside their function
body:

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

Move this work into an async function and call the function from a document
expression or another module API.

## Invalid: explicit await in a document expression

```mdx
{await loadSummary()}
```

Return `loadSummary()` directly. MarkScript awaits the returned promise.

## Invalid: explicit await in a JSX attribute expression

```mdx
<Report summary={await loadSummary()} />
```

Pass `loadSummary()` directly as the attribute value. MarkScript awaits the
returned promise before calling the component.
