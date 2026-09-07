import type {Nodes, Parent, Root} from 'mdast'
import type {DocxData} from './types.ts'

export type AnyNode = Nodes | Root

export interface MutableVisit {
  node: AnyNode
  parent?: Parent
  index?: number
  path: string
}

export function visitMutable(
  root: Root,
  callback: (visit: MutableVisit) => void,
): void {
  const walk = (
    node: AnyNode,
    parent: Parent | undefined,
    index: number | undefined,
    path: string,
  ) => {
    callback({
      node,
      ...(parent === undefined ? {} : {parent}),
      ...(index === undefined ? {} : {index}),
      path,
    })
    if (!('children' in node) || !Array.isArray(node.children)) return
    for (
      let childIndex = 0;
      childIndex < node.children.length;
      childIndex += 1
    ) {
      const child = node.children[childIndex]
      if (child !== undefined) {
        walk(child, node, childIndex, `${path}.children[${childIndex}]`)
      }
    }
  }
  walk(root, undefined, undefined, '$')
}

export function replaceChild(
  parent: Parent,
  index: number,
  replacement: readonly Parent['children'][number][],
): void {
  parent.children.splice(index, 1, ...replacement)
}

export function docxData(node: AnyNode): DocxData {
  node.data ??= {}
  const current = node.data.docx
  if (current === undefined) {
    const created: DocxData = {}
    node.data.docx = created
    return created
  }
  if (!isRecord(current)) {
    throw new TypeError(`node.data.docx on ${node.type} must be an object`)
  }
  return current
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function plainText(node: AnyNode): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  if (!('children' in node) || !Array.isArray(node.children)) return ''
  return node.children.map((child) => plainText(child)).join('')
}

export function clonePlain<T>(value: T, path = '$'): T {
  return clone(value, path, new WeakSet()) as T
}

function clone(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers`)
    }
    return value
  }
  if (
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new TypeError(`${path} must contain only plain serializable data`)
  }
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    const result: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor === undefined) {
        result.push(null)
        continue
      }
      if (!('value' in descriptor)) {
        throw new TypeError(`${path}[${index}] is an accessor property`)
      }
      result.push(
        descriptor.value === undefined
          ? null
          : clone(descriptor.value, `${path}[${index}]`, ancestors),
      )
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue
      if (
        typeof key === 'string' &&
        /^(?:0|[1-9]\d*)$/u.test(key) &&
        Number(key) < value.length
      ) {
        continue
      }
      throw new TypeError(`${path} contains a non-index array property`)
    }
    ancestors.delete(value)
    return result
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      `${path} contains an opaque ${value.constructor?.name ?? 'object'}`,
    )
  }
  const result: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new TypeError(`${path} contains a symbol property`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined) continue
    if (!('value' in descriptor)) {
      throw new TypeError(`${path}.${key} is an accessor property`)
    }
    if (!descriptor.enumerable || descriptor.value === undefined) continue
    result[key] = clone(descriptor.value, `${path}.${key}`, ancestors)
  }
  ancestors.delete(value)
  return result
}
