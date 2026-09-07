import type {RuntimeSourceLocation} from './errors.ts'
import {MARK_VALUE, type MarkAnnotation, type MarkGroup} from './types.ts'

export function directiveAnnotation(
  namespace: string,
  props: Readonly<Record<string, unknown>>,
  source?: RuntimeSourceLocation,
): MarkAnnotation {
  return source === undefined
    ? {[MARK_VALUE]: 'annotation', namespace, props}
    : {[MARK_VALUE]: 'annotation', namespace, props, source}
}

export function directiveGroup(
  namespace: string,
  props: Readonly<Record<string, unknown>>,
  children: unknown,
  source?: RuntimeSourceLocation,
): MarkGroup {
  return source === undefined
    ? {[MARK_VALUE]: 'group', namespace, props, children}
    : {[MARK_VALUE]: 'group', namespace, props, children, source}
}

export const attach = directiveAnnotation
export const group = directiveGroup
