import type {} from '@markscript/mdast-util-mdx-directive'
import type {Nodes, Root} from 'mdast'
import {runtimeError} from './errors.ts'

export type MdastContentContext =
  | 'root'
  | 'block'
  | 'list'
  | 'phrasing'
  | 'link'

type NodeRecord = Record<string, unknown> & {type: string}

const BLOCK_TYPES = new Set([
  'blockquote',
  'code',
  'heading',
  'html',
  'list',
  'paragraph',
  'table',
  'thematicBreak',
  'containerDirective',
  'leafDirective',
])

const DEFINITION_TYPES = new Set(['definition', 'footnoteDefinition'])
const FRONTMATTER_TYPES = new Set(['yaml'])
const PHRASING_TYPES = new Set([
  'break',
  'delete',
  'emphasis',
  'footnoteReference',
  'html',
  'image',
  'imageReference',
  'inlineCode',
  'link',
  'linkReference',
  'strong',
  'text',
  'textDirective',
])
const ALL_NODE_TYPES = new Set([
  ...BLOCK_TYPES,
  ...DEFINITION_TYPES,
  ...FRONTMATTER_TYPES,
  ...PHRASING_TYPES,
  'listItem',
  'root',
  'tableCell',
  'tableRow',
])

type ChildContext =
  | MdastContentContext
  | 'block-or-definition'
  | 'table'
  | 'row'

interface ValidationState {
  readonly seen: WeakMap<object, string>
}

export function isMdastCandidate(value: unknown): value is NodeRecord {
  return isRecord(value) && typeof value.type === 'string'
}

/** Validate a completed canonical MDAST root. */
export function validateRoot(value: unknown): asserts value is Root {
  if (!isMdastCandidate(value) || value.type !== 'root') {
    runtimeError('ERR1201', 'the completed document must be an MDAST root', {
      path: '$',
    })
  }
  validateNode(value, undefined, '$', {seen: new WeakMap()})
}

/** Validate an inserted MDAST value and its full subtree for a parent context. */
export function validateNodeForContext(
  value: unknown,
  context: MdastContentContext,
  path: string,
): asserts value is Nodes {
  if (!isMdastCandidate(value)) {
    runtimeError('ERR1201', 'expected an MDAST node', {path})
  }
  validateNode(value, context, path, {seen: new WeakMap()})
}

function validateNode(
  value: unknown,
  expected: ChildContext | undefined,
  path: string,
  state: ValidationState,
): asserts value is Nodes {
  if (!isMdastCandidate(value)) {
    runtimeError('ERR1201', 'expected an MDAST node object', {path})
  }

  const firstPath = state.seen.get(value)
  if (firstPath !== undefined) {
    runtimeError(
      'ERR1202',
      `MDAST must be a tree; this node was already used at ${firstPath}`,
      {path},
    )
  }
  state.seen.set(value, path)

  if (!ALL_NODE_TYPES.has(value.type)) {
    runtimeError('ERR1201', `unknown MDAST node type \`${value.type}\``, {path})
  }
  if (expected !== undefined && !isAllowedIn(value.type, expected)) {
    runtimeError(
      'ERR1104',
      `MDAST node \`${value.type}\` is invalid in ${describeContext(expected)} context`,
      {path},
    )
  }

  validateCommonFields(value, path)

  switch (value.type) {
    case 'root':
      if (expected !== undefined) {
        runtimeError('ERR1104', 'a nested MDAST root is invalid', {path})
      }
      forbiddenField(value, 'value', path)
      validateChildren(value, 'root', path, state)
      return
    case 'blockquote':
    case 'footnoteDefinition':
    case 'listItem':
      forbiddenField(value, 'value', path)
      validateChildren(value, 'block-or-definition', path, state)
      if (value.type === 'footnoteDefinition') validateAssociation(value, path)
      if (value.type === 'listItem') {
        optionalBooleanOrNull(value, 'checked', path)
        optionalBooleanOrNull(value, 'spread', path)
      }
      return
    case 'containerDirective':
      forbiddenField(value, 'value', path)
      validateDirectiveFields(value, path)
      validateChildren(value, 'block-or-definition', path, state)
      return
    case 'leafDirective':
    case 'textDirective':
      forbiddenField(value, 'value', path)
      validateDirectiveFields(value, path)
      validateChildren(
        value,
        expected === 'link' ? 'link' : 'phrasing',
        path,
        state,
      )
      return
    case 'heading': {
      forbiddenField(value, 'value', path)
      const depth = value.depth
      if (
        typeof depth !== 'number' ||
        !Number.isInteger(depth) ||
        depth < 1 ||
        depth > 6
      ) {
        invalidField(path, 'depth', 'an integer from 1 through 6')
      }
      validateChildren(value, 'phrasing', path, state)
      return
    }
    case 'paragraph':
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'tableCell':
      forbiddenField(value, 'value', path)
      validateChildren(
        value,
        expected === 'link' ? 'link' : 'phrasing',
        path,
        state,
      )
      return
    case 'link':
      forbiddenField(value, 'value', path)
      validateResource(value, path)
      validateChildren(value, 'link', path, state)
      return
    case 'linkReference':
      forbiddenField(value, 'value', path)
      validateReference(value, path)
      validateChildren(value, 'link', path, state)
      return
    case 'list':
      forbiddenField(value, 'value', path)
      optionalBooleanOrNull(value, 'ordered', path)
      optionalBooleanOrNull(value, 'spread', path)
      optionalFiniteIntegerOrNull(value, 'start', path)
      validateChildren(value, 'list', path, state)
      return
    case 'table':
      forbiddenField(value, 'value', path)
      validateAlignment(value, path)
      validateChildren(value, 'table', path, state)
      return
    case 'tableRow':
      forbiddenField(value, 'value', path)
      validateChildren(value, 'row', path, state)
      return
    case 'code':
      forbiddenField(value, 'children', path)
      requiredString(value, 'value', path)
      optionalStringOrNull(value, 'lang', path)
      optionalStringOrNull(value, 'meta', path)
      return
    case 'html':
    case 'inlineCode':
    case 'text':
    case 'yaml':
      forbiddenField(value, 'children', path)
      requiredString(value, 'value', path)
      return
    case 'definition':
      forbiddenField(value, 'children', path)
      forbiddenField(value, 'value', path)
      validateAssociation(value, path)
      validateResource(value, path)
      return
    case 'footnoteReference':
      forbiddenField(value, 'children', path)
      forbiddenField(value, 'value', path)
      validateAssociation(value, path)
      return
    case 'image':
      forbiddenField(value, 'children', path)
      forbiddenField(value, 'value', path)
      validateResource(value, path)
      optionalStringOrNull(value, 'alt', path)
      return
    case 'imageReference':
      forbiddenField(value, 'children', path)
      forbiddenField(value, 'value', path)
      validateReference(value, path)
      optionalStringOrNull(value, 'alt', path)
      return
    case 'break':
    case 'thematicBreak':
      forbiddenField(value, 'children', path)
      forbiddenField(value, 'value', path)
      return
  }
}

function validateChildren(
  node: NodeRecord,
  expected: ChildContext,
  path: string,
  state: ValidationState,
): void {
  if (!Array.isArray(node.children)) {
    invalidField(path, 'children', 'an array')
  }
  for (const [index, child] of node.children.entries()) {
    validateNode(child, expected, `${path}.children[${index}]`, state)
  }
}

function validateCommonFields(node: NodeRecord, path: string): void {
  if (node.data !== undefined && !isRecord(node.data)) {
    invalidField(path, 'data', 'an object')
  }
  if (node.position !== undefined)
    validatePosition(node.position, `${path}.position`)
}

function validatePosition(value: unknown, path: string): void {
  if (!isRecord(value)) {
    runtimeError('ERR1201', 'position must be an object', {path})
  }
  validatePoint(value.start, `${path}.start`)
  validatePoint(value.end, `${path}.end`)
}

function validatePoint(value: unknown, path: string): void {
  if (!isRecord(value)) {
    runtimeError('ERR1201', 'point must be an object', {path})
  }
  if (!isPositiveInteger(value.line)) {
    runtimeError('ERR1201', 'point.line must be a positive integer', {path})
  }
  if (!isPositiveInteger(value.column)) {
    runtimeError('ERR1201', 'point.column must be a positive integer', {path})
  }
  if (
    value.offset !== undefined &&
    (!isFiniteInteger(value.offset) || value.offset < 0)
  ) {
    runtimeError('ERR1201', 'point.offset must be a non-negative integer', {
      path,
    })
  }
}

function validateAssociation(node: NodeRecord, path: string): void {
  requiredString(node, 'identifier', path)
  optionalStringOrNull(node, 'label', path)
}

function validateReference(node: NodeRecord, path: string): void {
  validateAssociation(node, path)
  if (
    node.referenceType !== 'shortcut' &&
    node.referenceType !== 'collapsed' &&
    node.referenceType !== 'full'
  ) {
    invalidField(path, 'referenceType', 'shortcut, collapsed, or full')
  }
}

function validateResource(node: NodeRecord, path: string): void {
  requiredString(node, 'url', path)
  optionalStringOrNull(node, 'title', path)
}

function validateAlignment(node: NodeRecord, path: string): void {
  const align = node.align
  if (align === undefined || align === null) return
  if (!Array.isArray(align)) invalidField(path, 'align', 'an array or null')
  for (const [index, value] of align.entries()) {
    if (
      value !== null &&
      value !== 'left' &&
      value !== 'right' &&
      value !== 'center'
    ) {
      runtimeError(
        'ERR1201',
        'table alignment must be left, right, center, or null',
        {path: `${path}.align[${index}]`},
      )
    }
  }
}

function validateDirectiveFields(node: NodeRecord, path: string): void {
  requiredString(node, 'name', path)
  const attributes = node.attributes
  if (attributes === undefined || attributes === null) return
  if (!isRecord(attributes)) {
    invalidField(path, 'attributes', 'an object or null')
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      runtimeError(
        'ERR1201',
        'directive attribute values must be strings or null',
        {path: `${path}.attributes.${name}`},
      )
    }
  }
}

function requiredString(node: NodeRecord, field: string, path: string): void {
  if (typeof node[field] !== 'string') invalidField(path, field, 'a string')
}

function optionalStringOrNull(
  node: NodeRecord,
  field: string,
  path: string,
): void {
  const value = node[field]
  if (value !== undefined && value !== null && typeof value !== 'string') {
    invalidField(path, field, 'a string or null')
  }
}

function optionalBooleanOrNull(
  node: NodeRecord,
  field: string,
  path: string,
): void {
  const value = node[field]
  if (value !== undefined && value !== null && typeof value !== 'boolean') {
    invalidField(path, field, 'a boolean or null')
  }
}

function optionalFiniteIntegerOrNull(
  node: NodeRecord,
  field: string,
  path: string,
): void {
  const value = node[field]
  if (value !== undefined && value !== null && !isFiniteInteger(value)) {
    invalidField(path, field, 'a finite integer or null')
  }
}

function invalidField(path: string, field: string, expected: string): never {
  runtimeError('ERR1201', `MDAST field \`${field}\` must be ${expected}`, {
    path,
  })
}

function forbiddenField(node: NodeRecord, field: string, path: string): void {
  if (Object.hasOwn(node, field)) {
    runtimeError(
      'ERR1201',
      `MDAST node \`${node.type}\` has forbidden field \`${field}\``,
      {
        path,
      },
    )
  }
}

function isAllowedIn(type: string, context: ChildContext): boolean {
  switch (context) {
    case 'root':
      return (
        BLOCK_TYPES.has(type) ||
        DEFINITION_TYPES.has(type) ||
        FRONTMATTER_TYPES.has(type)
      )
    case 'block':
      return BLOCK_TYPES.has(type) || DEFINITION_TYPES.has(type)
    case 'block-or-definition':
      return BLOCK_TYPES.has(type) || DEFINITION_TYPES.has(type)
    case 'phrasing':
      return PHRASING_TYPES.has(type)
    case 'link':
      return (
        type !== 'link' && type !== 'linkReference' && PHRASING_TYPES.has(type)
      )
    case 'list':
      return type === 'listItem'
    case 'table':
      return type === 'tableRow'
    case 'row':
      return type === 'tableCell'
  }
}

function describeContext(context: ChildContext): string {
  if (context === 'block-or-definition') return 'flow'
  return context
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  )
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteInteger(value) && value > 0
}
