import {type RuntimeSourceLocation, runtimeError} from './errors.ts'
import {isIntrinsicName} from './intrinsics.ts'
import {
  type ChildrenProps,
  Fragment,
  type ImageProps,
  type LinkProps,
  MARK_VALUE,
  type MarkComponent,
  type MarkElement,
  type MarkFragment,
  type MarkValue,
  type OrderedListProps,
  type VoidProps,
} from './types.ts'

export {Fragment}

type EmptyComponentResult = ReturnType<() => void>
type ComponentResult =
  | MarkValue
  | EmptyComponentResult
  | PromiseLike<MarkValue | undefined>
type TypedComponent = (props: never) => ComponentResult
type ComponentProps<Component> = Component extends (
  props: infer Props,
) => unknown
  ? Props
  : never
type JsxKey = null | undefined
type FragmentProps = ChildrenProps | null

export function jsx(
  type: typeof Fragment,
  rawProps: FragmentProps,
  key?: JsxKey,
): MarkValue
export function jsx<Name extends keyof JSX.IntrinsicElements>(
  type: Name,
  rawProps: JSX.IntrinsicElements[Name],
  key?: JsxKey,
): MarkValue
export function jsx<Component extends TypedComponent>(
  type: Component,
  rawProps: NoInfer<ComponentProps<Component>>,
  key?: JsxKey,
): MarkValue
export function jsx(
  type: unknown,
  rawProps: unknown,
  key?: unknown,
): MarkValue {
  return createJsxValue(type, rawProps, key, undefined)
}

export const jsxs: typeof jsx = jsx

export function jsxDEV(
  type: typeof Fragment,
  rawProps: FragmentProps,
  key?: JsxKey,
  isStaticChildren?: boolean,
  source?: RuntimeSourceLocation,
  self?: unknown,
): MarkValue
export function jsxDEV<Name extends keyof JSX.IntrinsicElements>(
  type: Name,
  rawProps: JSX.IntrinsicElements[Name],
  key?: JsxKey,
  isStaticChildren?: boolean,
  source?: RuntimeSourceLocation,
  self?: unknown,
): MarkValue
export function jsxDEV<Component extends TypedComponent>(
  type: Component,
  rawProps: NoInfer<ComponentProps<Component>>,
  key?: JsxKey,
  isStaticChildren?: boolean,
  source?: RuntimeSourceLocation,
  self?: unknown,
): MarkValue
export function jsxDEV(
  type: unknown,
  rawProps: unknown,
  key?: unknown,
  _isStaticChildren?: boolean,
  source?: RuntimeSourceLocation,
  _self?: unknown,
): MarkValue {
  return createJsxValue(type, rawProps, key, source)
}

function createJsxValue(
  type: unknown,
  rawProps: unknown,
  key: unknown,
  source: RuntimeSourceLocation | undefined,
): MarkValue {
  if (key !== undefined && key !== null) {
    runtimeError('ERR1102', 'JSX keys have no MarkScript/MDAST meaning', {
      source,
    })
  }

  const props = normalizeProps(rawProps, source)
  if (type === Fragment) {
    for (const name of Object.keys(props)) {
      if (name !== 'children') {
        runtimeError(
          'ERR1102',
          `attribute \`${name}\` is invalid on a fragment`,
          {
            source,
          },
        )
      }
    }
    const fragment: Omit<MarkFragment, 'source'> = {
      [MARK_VALUE]: 'fragment',
      children: props.children,
    }
    return withOptionalSource(fragment, source)
  }

  if (typeof type === 'function') {
    const component: Omit<MarkComponent, 'source'> = {
      [MARK_VALUE]: 'component',
      render: type as MarkComponent['render'],
      props,
    }
    return withOptionalSource(component, source)
  }

  if (typeof type !== 'string') {
    runtimeError(
      'ERR1101',
      'JSX element type must be an intrinsic name or component function',
      {
        source,
      },
    )
  }

  if (!isIntrinsicName(type)) {
    runtimeError(
      'ERR1101',
      `JSX intrinsic <${type}> lies outside the Markdown vocabulary`,
      {source},
    )
  }

  const element: Omit<MarkElement, 'source'> = {
    [MARK_VALUE]: 'element',
    name: type,
    props: copyPropsWithoutChildren(props),
    children: props.children,
  }
  return withOptionalSource(element, source)
}

function normalizeProps(
  rawProps: unknown,
  source: RuntimeSourceLocation | undefined,
): Record<string, unknown> {
  if (rawProps === undefined || rawProps === null) return {}
  if (typeof rawProps !== 'object' || Array.isArray(rawProps)) {
    runtimeError('ERR1102', 'JSX props must be an object', {source})
  }
  return rawProps as Record<string, unknown>
}

function copyPropsWithoutChildren(
  props: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {}
  for (const name of Object.keys(props)) {
    if (name === 'children') continue
    Object.defineProperty(result, name, {
      configurable: true,
      enumerable: true,
      value: props[name],
      writable: true,
    })
  }
  return result
}

function withOptionalSource<T extends object>(
  value: T,
  source: RuntimeSourceLocation | undefined,
): T & {readonly source?: RuntimeSourceLocation} {
  return source === undefined ? value : {...value, source}
}

export namespace JSX {
  export type Element = MarkValue
  export type ElementType = keyof IntrinsicElements | TypedComponent

  export interface ElementChildrenAttribute {
    children: unknown
  }

  // biome-ignore lint/complexity/noBannedTypes: JSX requires an empty intrinsic-attribute contract so keys stay forbidden.
  export type IntrinsicAttributes = {}

  export interface IntrinsicElements {
    h1: ChildrenProps
    h2: ChildrenProps
    h3: ChildrenProps
    h4: ChildrenProps
    h5: ChildrenProps
    h6: ChildrenProps
    p: ChildrenProps
    em: ChildrenProps
    strong: ChildrenProps
    a: LinkProps
    img: ImageProps
    blockquote: ChildrenProps
    ul: ChildrenProps
    ol: OrderedListProps
    li: ChildrenProps
    br: VoidProps
    hr: VoidProps
    code: ChildrenProps
    pre: ChildrenProps
  }
}
