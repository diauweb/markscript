import type {Nodes} from 'mdast'

/**
 * Return a detached copy of an MDAST tree with every node's `data` removed.
 *
 * Final-lifetime trees are frozen, so this helper returns a detached copy.
 * Unknown non-plain values in extension fields are preserved by
 * reference; ordinary node fields, arrays, positions, and plain objects are
 * copied.
 */
export function stripData<T extends Nodes>(tree: T): T {
  return cloneValue(tree, new WeakMap<object, unknown>(), true) as T
}

/** Return a detached mutable copy of a completed MDAST tree. */
export function cloneTree<T extends Nodes>(tree: T): T {
  return cloneValue(tree, new WeakMap<object, unknown>(), false) as T
}

function cloneValue(
  value: unknown,
  seen: WeakMap<object, unknown>,
  omitNodeData: boolean,
): unknown {
  if (typeof value !== 'object' || value === null) return value

  const prior = seen.get(value)
  if (prior !== undefined) return prior

  if (Array.isArray(value)) {
    const clone: unknown[] = []
    seen.set(value, clone)
    for (const item of value) clone.push(cloneValue(item, seen, omitNodeData))
    return clone
  }

  if (!isPlainObject(value)) return value

  const clone: Record<PropertyKey, unknown> = {}
  seen.set(value, clone)
  const isNode = typeof (value as {type?: unknown}).type === 'string'

  for (const key of Reflect.ownKeys(value)) {
    if (omitNodeData && isNode && key === 'data') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor)) continue
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      value: cloneValue(descriptor.value, seen, omitNodeData),
      writable: true,
    })
  }
  return clone
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}
