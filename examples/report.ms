import {onReady, onTransform} from '@markscript/markscript'

export const title = 'Quarterly report'

export function Note({children}: {children?: unknown}) {
  return (
    <blockquote>
      <strong>Note: </strong>
      {children}
    </blockquote>
  )
}

# {title}

::ref{id=summary visibility=public}
::style{role=lead}

<Note>
Generated with **MarkScript**.
</Note>

{
  onTransform(({root}) => {
    root.data = {...root.data, reviewed: true}
  })
}

{
  onReady(({root}) => {
    console.error(`${root.children.length} top-level nodes`)
  })
}
