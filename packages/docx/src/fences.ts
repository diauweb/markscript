import type {Code, Nodes, Parent, Root} from 'mdast'
import {isRecord} from './tree.ts'

export type FenceNode = Code & {lang: string}

export async function transformFences(
  root: Root,
  language: string,
  transform: (
    node: FenceNode,
    parent: Parent,
    path: string,
  ) => Nodes | readonly Nodes[] | Promise<Nodes | readonly Nodes[]>,
): Promise<void> {
  const walk = async (parent: Parent, path: string): Promise<void> => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]
      if (child === undefined) continue
      const childPath = `${path}.children[${index}]`
      const fence = fenceNode(child, language)
      if (fence !== undefined) {
        const replacement = await transform(fence, parent, childPath)
        const nodes = Array.isArray(replacement) ? replacement : [replacement]
        parent.children.splice(index, 1, ...nodes)
        index += nodes.length - 1
        continue
      }
      if ('children' in child && Array.isArray(child.children)) {
        await walk(child, childPath)
      }
    }
  }
  await walk(root, '$')
}

export function fenceNode(
  node: Nodes,
  language?: string,
): FenceNode | undefined {
  if (node.type !== 'code' || typeof node.lang !== 'string') return undefined
  if (language !== undefined && node.lang !== language) return undefined
  return node as FenceNode
}

export function fenceOptions(
  node: FenceNode,
): Readonly<Record<string, unknown>> {
  const value = node.data?.[node.lang]
  return isRecord(value) ? value : {}
}
