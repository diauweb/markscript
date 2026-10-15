/** @jsxImportSource react */
import type {Nodes} from 'hast'
import {defaultSchema, sanitize} from 'hast-util-sanitize'
import {toJsxRuntime} from 'hast-util-to-jsx-runtime'
import type {Root} from 'mdast'
import {toHast} from 'mdast-util-to-hast'
import {Fragment, useId, useMemo} from 'react'
import {jsx, jsxs} from 'react/jsx-runtime'

export function renderDocument(root: Root, prefix: string) {
  const tree = sanitize(
    toHast(root, {clobberPrefix: '', unknownHandler: () => undefined}),
    {...defaultSchema, clobberPrefix: prefix},
  )
  const links = (node: Nodes) => {
    if (node.type === 'element') {
      const href = node.properties.href
      if (typeof href === 'string' && href.startsWith('#'))
        node.properties.href = `#${prefix}${href.slice(1)}`
    }
    if ('children' in node) for (const child of node.children) links(child)
  }
  links(tree)
  return toJsxRuntime(tree, {Fragment, jsx, jsxs})
}

export function Document({root}: {root: Root}) {
  const id = useId()
  const content = useMemo(() => renderDocument(root, `msh-${id}-`), [root, id])
  return <div className="prose">{content}</div>
}
