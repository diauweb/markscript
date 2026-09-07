import type {Data, Nodes} from 'mdast'
import {MarkScriptRuntimeError, runtimeError} from './errors.ts'
import type {MarkAnnotation} from './types.ts'

export type AnnotationProperties = Record<string, unknown>
export type PendingAnnotations = Map<string, AnnotationProperties>

export function createPendingAnnotations(): PendingAnnotations {
  return new Map()
}

/** Merge one annotation into the sequence-local pending set. */
export function mergePendingAnnotation(
  pending: PendingAnnotations,
  annotation: MarkAnnotation,
  path: string,
): void {
  if (annotation.namespace.length === 0) {
    runtimeError('ERR1105', 'a directive annotation requires a namespace', {
      path,
      source: annotation.source,
    })
  }

  const existing = pending.get(annotation.namespace)
  const merged = copyProperties(existing)
  copyPropertiesInto(merged, annotation.props)
  pending.set(annotation.namespace, merged)
}

/** Attach all pending annotations to one emitted node, then consume them. */
export function attachPendingAnnotations(
  node: Nodes,
  pending: PendingAnnotations,
  path: string,
): void {
  if (pending.size === 0) return

  try {
    attachPendingAnnotationsUnchecked(node, pending, path)
  } catch (error) {
    if (error instanceof MarkScriptRuntimeError) throw error
    runtimeError('ERR1105', 'annotation target is an immutable MDAST node', {
      cause: error,
      path,
    })
  }
}

function attachPendingAnnotationsUnchecked(
  node: Nodes,
  pending: PendingAnnotations,
  path: string,
): void {
  const data = ensureData(node, path)
  for (const [namespace, properties] of pending) {
    const current = ownValue(data, namespace)
    if (current !== undefined && !isPlainRecord(current)) {
      runtimeError(
        'ERR1105',
        `annotation namespace \`${namespace}\` conflicts with non-object node.data`,
        {path},
      )
    }

    const merged = copyProperties(current === undefined ? undefined : current)
    copyPropertiesInto(merged, properties)
    defineOwn(data, namespace, merged)
  }
  pending.clear()
}

export function assertNoPendingAnnotations(
  pending: PendingAnnotations,
  path: string,
): void {
  if (pending.size === 0) return
  const namespaces = [...pending.keys()].map((name) => `:${name}`).join(', ')
  runtimeError(
    'ERR1105',
    `annotation${pending.size === 1 ? '' : 's'} ${namespaces} reached the end of the sequence before a compatible node`,
    {path},
  )
}

function ensureData(node: Nodes, path: string): Data {
  if (node.data === undefined) {
    node.data = {}
    return node.data
  }
  if (!isPlainRecord(node.data)) {
    runtimeError('ERR1201', 'MDAST node.data must be an object', {path})
  }
  return node.data
}

function copyProperties(
  source: Readonly<Record<string, unknown>> | undefined,
): AnnotationProperties {
  const result: AnnotationProperties = {}
  if (source !== undefined) copyPropertiesInto(result, source)
  return result
}

function copyPropertiesInto(
  target: AnnotationProperties,
  source: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.keys(source)) {
    defineOwn(target, key, source[key])
  }
}

function defineOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function ownValue(target: object, key: string): unknown {
  return Object.hasOwn(target, key)
    ? (target as Record<string, unknown>)[key]
    : undefined
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}
