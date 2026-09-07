import {runtimeError} from './errors.ts'
import {
  isMarkComponent,
  isMarkElement,
  isMarkFragment,
  isMarkGroup,
  type MarkComponent,
  type MarkElement,
  type MarkFragment,
  type MarkGroup,
  type MarkValue,
} from './types.ts'

/** Resolve component invocations depth-first and left-to-right. */
export async function resolveComponents(value: MarkValue): Promise<MarkValue> {
  return (await resolveValue(value)).value as MarkValue
}

/** Resolve synchronous component invocations for direct lowering callers. */
export function resolveComponentsSync(value: MarkValue): MarkValue {
  return resolveValueSync(value) as MarkValue
}

interface ResolvedValue {
  value: unknown
}

async function resolveValue(value: unknown): Promise<ResolvedValue> {
  if (isMarkComponent(value)) {
    const props = await resolveProps(value.props)
    return resolveValue(await value.render(props))
  }
  if (Array.isArray(value)) {
    const resolved: unknown[] = []
    for (const child of value) {
      resolved.push((await resolveValue(child)).value)
    }
    return {value: resolved}
  }
  if (isMarkElement(value)) {
    const children = (await resolveValue(value.children)).value
    return {value: withResolvedChildren(value, children)}
  }
  if (isMarkFragment(value)) {
    const children = (await resolveValue(value.children)).value
    return {value: withResolvedChildren(value, children)}
  }
  if (isMarkGroup(value)) {
    const children = (await resolveValue(value.children)).value
    return {value: withResolvedChildren(value, children)}
  }
  return {value}
}

function resolveValueSync(value: unknown): unknown {
  if (isMarkComponent(value)) {
    const props = resolvePropsSync(value.props)
    const result = value.render(props)
    if (isThenable(result)) asyncComponentRequiresDocumentExecution(value)
    return resolveValueSync(result)
  }
  if (Array.isArray(value)) return value.map(resolveValueSync)
  if (isMarkElement(value)) {
    return withResolvedChildren(value, resolveValueSync(value.children))
  }
  if (isMarkFragment(value)) {
    return withResolvedChildren(value, resolveValueSync(value.children))
  }
  if (isMarkGroup(value)) {
    return withResolvedChildren(value, resolveValueSync(value.children))
  }
  return value
}

async function resolveProps(
  props: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(props, 'children')) return props
  return {...props, children: (await resolveValue(props.children)).value}
}

function resolvePropsSync(
  props: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (!Object.hasOwn(props, 'children')) return props
  return {...props, children: resolveValueSync(props.children)}
}

function withResolvedChildren<T extends MarkElement | MarkFragment | MarkGroup>(
  value: T,
  children: unknown,
): T {
  return children === value.children ? value : {...value, children}
}

function asyncComponentRequiresDocumentExecution(
  component: MarkComponent,
): never {
  runtimeError(
    'ERR1103',
    'an async component requires executeDocument() so it can resolve before MDAST lowering',
    {source: component.source},
  )
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof (value as {then?: unknown}).then === 'function'
  )
}
