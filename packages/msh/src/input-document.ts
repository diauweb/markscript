import {parseMarkscript} from '@markscript/compiler'
import {type IntrinsicName, jsx, lowerToRoot} from '@markscript/runtime'
import type {Nodes, Root, RootContent} from 'mdast'

type SourceNode = NonNullable<ReturnType<typeof parseMarkscript>['tree']>

/** Format an inert conversation document without loading its modules or expressions. */
export function inputDocument(source: string): Root {
  const parsed = parseMarkscript(source, 'conversation.ms')
  const code = (node: SourceNode): Nodes => {
    const value = source.slice(
      node.position?.start.offset ?? 0,
      node.position?.end.offset ?? source.length,
    )
    return node.type === 'mdxTextExpression' ||
      node.type === 'mdxJsxTextElement'
      ? {type: 'inlineCode', value}
      : {type: 'code', lang: 'markscript', value}
  }
  const children = (nodes: SourceNode[]): Nodes[] => {
    const result: Nodes[] = []
    let annotations: Record<string, unknown> = {}
    for (const node of nodes) {
      if (node.type === 'leafDirective' || node.type === 'textDirective') {
        annotations = {...annotations, [node.name ?? '']: attributes(node)}
        continue
      }
      const values = convert(node)
      for (const [index, value] of values.entries()) {
        result.push(
          index === 0 && Object.keys(annotations).length
            ? {...value, data: {...value.data, ...annotations}}
            : value,
        )
      }
      if (values.length) annotations = {}
    }
    return result
  }
  const attributes = (node: SourceNode) =>
    Object.fromEntries(
      (node.directiveAttributes ?? node.attributes ?? []).flatMap(
        (attribute) =>
          attribute.type === 'mdxJsxAttribute' &&
          (attribute.value === null || typeof attribute.value === 'string')
            ? [[attribute.name, attribute.value ?? true]]
            : [],
      ),
    )
  const convert = (node: SourceNode): Nodes[] => {
    if (node.type === 'containerDirective')
      return children(node.children ?? []).map((child) => ({
        ...child,
        data: {...child.data, [node.name ?? '']: attributes(node)},
      }))
    if (node.type === 'mdxjsEsm' || node.type.endsWith('Expression'))
      return [code(node)]
    if (node.type.startsWith('mdxJsx')) {
      if (!node.name) return children(node.children ?? [])
      if (
        (node.attributes ?? []).some(
          (attribute) =>
            attribute.type !== 'mdxJsxAttribute' ||
            (typeof attribute.value === 'object' && attribute.value !== null),
        )
      )
        return [code(node)]
      try {
        const element = jsx(node.name as IntrinsicName, {
          ...attributes(node),
          children: children(node.children ?? []),
        })
        const root = lowerToRoot(
          node.type === 'mdxJsxTextElement'
            ? jsx('p', {children: element})
            : element,
        )
        const first = root.children[0]
        return node.type === 'mdxJsxTextElement' && first?.type === 'paragraph'
          ? first.children
          : root.children
      } catch {
        return [code(node)]
      }
    }
    if (node.type === 'html') return [code(node)]
    return [
      {
        ...node,
        ...(node.children ? {children: children(node.children)} : {}),
      } as Nodes,
    ]
  }
  return parsed.tree
    ? {
        type: 'root',
        children: children(parsed.tree.children ?? []) as RootContent[],
      }
    : {
        type: 'root',
        children: [{type: 'code', lang: 'markscript', value: source}],
      }
}
