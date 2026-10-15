export const renderingSource = (
  marker: string,
) => `import {appendFileSync} from 'node:fs'
import {onReady, onTransform} from '@markscript/runtime'

export const answer = 6 * 7

export async function Summary(): Promise<string> {
  appendFileSync(${JSON.stringify(marker)}, 'component;')
  await Promise.resolve()
  return 'Component value ' + answer
}

## Computed {answer}

<blockquote><p><Summary /></p></blockquote>

:::callout{tone="info"}
Directive **content**.
:::

| Result | Value |
| --- | ---: |
| Computed | 42 |

- [x] Completed
- [ ] Pending

See the note[^result].

[^result]: Final document footnote.

{onTransform(async ({root}) => {
  await Promise.resolve()
  root.children.push({type:'paragraph', children:[{type:'text',value:'Transformed document'}]})
})}

{onReady(async () => {
  await Promise.resolve()
  appendFileSync(${JSON.stringify(marker)}, 'ready;')
})}
`
