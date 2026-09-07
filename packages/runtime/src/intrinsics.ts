import {runtimeError} from './errors.ts'
import type {IntrinsicName, MarkElement} from './types.ts'

const INTRINSIC_NAMES = new Set<string>([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'em',
  'strong',
  'a',
  'img',
  'blockquote',
  'ul',
  'ol',
  'li',
  'br',
  'hr',
  'code',
  'pre',
])

export function isIntrinsicName(value: string): value is IntrinsicName {
  return INTRINSIC_NAMES.has(value)
}

export function assertAllowedProps(
  element: MarkElement,
  allowed: readonly string[],
  path: string,
): void {
  const allowedNames = new Set(allowed)
  for (const name of Object.keys(element.props)) {
    if (!allowedNames.has(name)) {
      runtimeError(
        'ERR1102',
        `attribute \`${name}\` is invalid on <${element.name}>`,
        {path, source: element.source},
      )
    }
  }
}

export function requiredStringProp(
  element: MarkElement,
  name: string,
  path: string,
): string {
  const value = element.props[name]
  if (typeof value !== 'string') {
    runtimeError(
      'ERR1102',
      `attribute \`${name}\` on <${element.name}> must be a string`,
      {path, source: element.source},
    )
  }
  return value
}

export function optionalStringProp(
  element: MarkElement,
  name: string,
  path: string,
): string | undefined {
  const value = element.props[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    runtimeError(
      'ERR1102',
      `attribute \`${name}\` on <${element.name}> must be a string`,
      {path, source: element.source},
    )
  }
  return value
}

export function optionalListStart(element: MarkElement, path: string): number {
  const value = element.props.start
  if (value === undefined) return 1
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    runtimeError(
      'ERR1102',
      'attribute `start` on <ol> must be a non-negative finite integer',
      {path, source: element.source},
    )
  }
  return value
}
