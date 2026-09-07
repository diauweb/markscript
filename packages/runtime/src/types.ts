import type {Nodes, Root} from 'mdast'
import type {RuntimeSourceLocation} from './errors.ts'

export interface CompilerData {
  noExport?: boolean
  [key: string]: unknown
}

declare module 'unist' {
  interface Data {
    /** Core compiler-facing metadata populated by `::compiler`. */
    compiler?: CompilerData
    /** Library-defined directive namespaces remain intentionally open. */
    [namespace: string]: unknown
  }
}

export const MARK_VALUE: unique symbol = Symbol('markscript.value')
export const Fragment: unique symbol = Symbol('markscript.fragment')

export type IntrinsicName =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'p'
  | 'em'
  | 'strong'
  | 'a'
  | 'img'
  | 'blockquote'
  | 'ul'
  | 'ol'
  | 'li'
  | 'br'
  | 'hr'
  | 'code'
  | 'pre'

export interface MarkElement {
  readonly [MARK_VALUE]: 'element'
  readonly name: IntrinsicName
  readonly props: Readonly<Record<string, unknown>>
  readonly children: unknown
  readonly source?: RuntimeSourceLocation
}

export interface MarkFragment {
  readonly [MARK_VALUE]: 'fragment'
  readonly children: unknown
  readonly source?: RuntimeSourceLocation
}

export interface MarkComponent {
  readonly [MARK_VALUE]: 'component'
  readonly render: (props: Record<string, unknown>) => unknown
  readonly props: Readonly<Record<string, unknown>>
  readonly source?: RuntimeSourceLocation
}

export interface MarkAnnotation {
  readonly [MARK_VALUE]: 'annotation'
  readonly namespace: string
  readonly props: Readonly<Record<string, unknown>>
  readonly source?: RuntimeSourceLocation
}

export interface MarkGroup {
  readonly [MARK_VALUE]: 'group'
  readonly namespace: string
  readonly props: Readonly<Record<string, unknown>>
  readonly children: unknown
  readonly source?: RuntimeSourceLocation
}

/** Values accepted from expressions and components while a document is rendered. */
export type MarkValue =
  | MarkElement
  | MarkFragment
  | MarkComponent
  | MarkAnnotation
  | MarkGroup
  | Nodes
  | readonly MarkValue[]
  | string
  | number
  | boolean
  | null
  | undefined

export interface TransformContext {
  root: Root
}

export interface ReadyContext {
  readonly root: ReadonlyRoot
}

/** Recursively read-only view used once the MDAST has been deep-frozen. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? {readonly [Key in keyof T]: DeepReadonly<T[Key]>}
      : T

export type ReadonlyRoot = DeepReadonly<Root>

export type TransformCallback = (context: TransformContext) => unknown

export type ReadyCallback = (context: ReadyContext) => unknown

export type MarkScriptEntry = () => Promise<Root>

export type DocumentRenderer = () => MarkValue | PromiseLike<MarkValue>

export interface ChildrenProps {
  /** Runtime lowering validates the value returned by arbitrary expressions. */
  children?: unknown
}

export interface LinkProps extends ChildrenProps {
  href: string
  title?: string
}

export interface ImageProps {
  src: string
  alt: string
  title?: string
  children?: never
}

export interface OrderedListProps extends ChildrenProps {
  start?: number
}

export interface VoidProps {
  children?: never
}

export function isMarkElement(value: unknown): value is MarkElement {
  return hasMarkBrand(value, 'element')
}

export function isMarkFragment(value: unknown): value is MarkFragment {
  return hasMarkBrand(value, 'fragment')
}

export function isMarkComponent(value: unknown): value is MarkComponent {
  return hasMarkBrand(value, 'component')
}

export function isMarkAnnotation(value: unknown): value is MarkAnnotation {
  return hasMarkBrand(value, 'annotation')
}

export function isMarkGroup(value: unknown): value is MarkGroup {
  return hasMarkBrand(value, 'group')
}

function hasMarkBrand(
  value: unknown,
  brand: 'element' | 'fragment' | 'component' | 'annotation' | 'group',
): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    MARK_VALUE in value &&
    (value as {[MARK_VALUE]?: unknown})[MARK_VALUE] === brand
  )
}
