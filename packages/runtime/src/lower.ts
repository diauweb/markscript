import type {
  Blockquote,
  Break,
  Code,
  Emphasis,
  Heading,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Text,
  ThematicBreak,
} from 'mdast'
import {
  assertNoPendingAnnotations,
  attachPendingAnnotations,
  createPendingAnnotations,
  mergePendingAnnotation,
} from './annotations.ts'
import {cloneTree} from './data.ts'
import {runtimeError} from './errors.ts'
import {
  assertAllowedProps,
  optionalListStart,
  optionalStringProp,
  requiredStringProp,
} from './intrinsics.ts'
import {resolveComponentsSync} from './resolve-components.ts'
import {
  isMarkAnnotation,
  isMarkElement,
  isMarkFragment,
  isMarkGroup,
  MARK_VALUE,
  type MarkElement,
  type MarkValue,
} from './types.ts'
import {
  isMdastCandidate,
  type MdastContentContext,
  validateNodeForContext,
  validateRoot,
} from './validate.ts'

export type LoweringContext = MdastContentContext

/** Materialize a graph of MarkScript values as one canonical MDAST root. */
export function lowerToRoot(value: MarkValue): Root {
  value = resolveComponentsSync(value)
  if (isMdastCandidate(value) && value.type === 'root') {
    validateRoot(value)
    return Object.isFrozen(value) ? cloneTree(value) : value
  }
  const children = lowerSequence(value, 'root', '$') as RootContent[]
  return {type: 'root', children}
}

function lowerSequence(
  value: unknown,
  context: LoweringContext,
  path: string,
): Nodes[] {
  const output: Nodes[] = []
  const pending = createPendingAnnotations()

  const emit = (current: unknown, currentPath: string): void => {
    if (isEmptyValue(current)) return

    if (Array.isArray(current)) {
      for (const [index, child] of current.entries()) {
        emit(child, `${currentPath}[${index}]`)
      }
      return
    }

    if (isMarkFragment(current)) {
      emit(current.children, `${currentPath}.children`)
      return
    }

    if (isMarkAnnotation(current)) {
      mergePendingAnnotation(pending, current, currentPath)
      return
    }

    if (isMarkGroup(current)) {
      const nodes = lowerSequence(
        current.children,
        context,
        `${currentPath}.children`,
      )
      if (nodes.length === 0) {
        runtimeError(
          'ERR1105',
          `directive group :::${current.namespace} contains no compatible nodes`,
          {path: currentPath, source: current.source},
        )
      }
      const first = nodes[0]
      if (first !== undefined && pending.size > 0) {
        attachPendingAnnotations(first, pending, currentPath)
      }
      for (const [index, node] of nodes.entries()) {
        const groupAnnotation = createPendingAnnotations()
        mergePendingAnnotation(
          groupAnnotation,
          {
            [MARK_VALUE]: 'annotation',
            namespace: current.namespace,
            props: current.props,
            ...(current.source === undefined ? {} : {source: current.source}),
          },
          `${currentPath}.children[${index}]`,
        )
        attachPendingAnnotations(
          node,
          groupAnnotation,
          `${currentPath}.children[${index}]`,
        )
      }
      output.push(...nodes)
      return
    }

    if (isMdastCandidate(current) && current.type === 'root') {
      if (context !== 'root' && context !== 'block') {
        runtimeError(
          'ERR1104',
          `an MDAST root is invalid in ${context} context`,
          {
            path: currentPath,
          },
        )
      }
      validateRoot(current)
      const root = Object.isFrozen(current) ? cloneTree(current) : current
      const children = root.children
      for (const [index, child] of children.entries()) {
        emit(child, `${currentPath}.children[${index}]`)
      }
      return
    }

    const nodes = lowerSingle(current, context, currentPath)
    if (nodes.length > 0 && pending.size > 0) {
      const first = nodes[0]
      if (first !== undefined)
        attachPendingAnnotations(first, pending, currentPath)
    }
    output.push(...nodes)
  }

  emit(value, path)
  assertNoPendingAnnotations(pending, path)
  return output
}

function lowerSingle(
  value: unknown,
  context: LoweringContext,
  path: string,
): Nodes[] {
  if (typeof value === 'string' || typeof value === 'number') {
    const text: Text = {type: 'text', value: String(value)}
    if (context === 'phrasing' || context === 'link') return [text]
    if (context === 'root' || context === 'block') {
      const paragraph: Paragraph = {type: 'paragraph', children: [text]}
      return [paragraph]
    }
    runtimeError(
      'ERR1104',
      `${typeof value} content is invalid directly inside a list`,
      {path},
    )
  }

  if (typeof value === 'boolean') {
    runtimeError(
      'ERR1103',
      'only false is an empty document value; true is unsupported',
      {
        path,
      },
    )
  }

  if (isMarkElement(value)) {
    if (
      (context === 'root' || context === 'block') &&
      isPhrasingIntrinsic(value.name)
    ) {
      const child = lowerElement(value, 'phrasing', path) as PhrasingContent
      const paragraph: Paragraph = {type: 'paragraph', children: [child]}
      return [paragraph]
    }
    return [lowerElement(value, context, path)]
  }

  if (isMdastCandidate(value)) {
    validateNodeForContext(value, context, path)
    return [value]
  }

  if (isThenable(value)) {
    runtimeError(
      'ERR1103',
      'a Promise remained inside a document value; return it directly from an expression or resolve nested promises with Promise.all',
      {path},
    )
  }

  runtimeError(
    'ERR1103',
    `unsupported document value ${describeValue(value)}; objects require explicit conversion`,
    {path},
  )
}

function isPhrasingIntrinsic(name: MarkElement['name']): boolean {
  return (
    name === 'em' ||
    name === 'strong' ||
    name === 'a' ||
    name === 'img' ||
    name === 'br' ||
    name === 'code'
  )
}

function lowerElement(
  element: MarkElement,
  context: LoweringContext,
  path: string,
): Nodes {
  switch (element.name) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      requireOutputContext(element, context, 'flow', path)
      assertAllowedProps(element, [], path)
      const depth = Number(element.name.slice(1)) as Heading['depth']
      const node: Heading = {
        type: 'heading',
        depth,
        children: lowerPhrasingChildren(element, path),
      }
      return node
    }
    case 'p': {
      requireOutputContext(element, context, 'flow', path)
      assertAllowedProps(element, [], path)
      const node: Paragraph = {
        type: 'paragraph',
        children: lowerPhrasingChildren(element, path),
      }
      return node
    }
    case 'em': {
      requireOutputContext(element, context, 'phrasing', path)
      assertAllowedProps(element, [], path)
      const node: Emphasis = {
        type: 'emphasis',
        children: lowerPhrasingChildren(
          element,
          path,
          context === 'link' ? 'link' : 'phrasing',
        ),
      }
      return node
    }
    case 'strong': {
      requireOutputContext(element, context, 'phrasing', path)
      assertAllowedProps(element, [], path)
      const node: Strong = {
        type: 'strong',
        children: lowerPhrasingChildren(
          element,
          path,
          context === 'link' ? 'link' : 'phrasing',
        ),
      }
      return node
    }
    case 'a': {
      if (context === 'link') {
        runtimeError('ERR1104', 'nested Markdown links are invalid', {
          path,
          source: element.source,
        })
      }
      requireOutputContext(element, context, 'phrasing', path)
      assertAllowedProps(element, ['href', 'title'], path)
      const href = requiredStringProp(element, 'href', path)
      const title = optionalStringProp(element, 'title', path)
      const base = {
        type: 'link' as const,
        url: href,
        children: lowerSequence(
          element.children,
          'link',
          `${path}.children`,
        ) as PhrasingContent[],
      }
      const node: Link = title === undefined ? base : {...base, title}
      return node
    }
    case 'img': {
      requireOutputContext(element, context, 'phrasing', path)
      assertAllowedProps(element, ['src', 'alt', 'title'], path)
      assertVoidChildren(element, path)
      const src = requiredStringProp(element, 'src', path)
      const alt = requiredStringProp(element, 'alt', path)
      const title = optionalStringProp(element, 'title', path)
      const base = {type: 'image' as const, url: src, alt}
      const node: Image = title === undefined ? base : {...base, title}
      return node
    }
    case 'blockquote': {
      requireOutputContext(element, context, 'flow', path)
      assertAllowedProps(element, [], path)
      const node: Blockquote = {
        type: 'blockquote',
        children: lowerSequence(
          element.children,
          'block',
          `${path}.children`,
        ) as Blockquote['children'],
      }
      return node
    }
    case 'ul':
    case 'ol': {
      requireOutputContext(element, context, 'flow', path)
      const ordered = element.name === 'ol'
      assertAllowedProps(element, ordered ? ['start'] : [], path)
      const node: List = ordered
        ? {
            type: 'list',
            ordered: true,
            start: optionalListStart(element, path),
            children: lowerSequence(
              element.children,
              'list',
              `${path}.children`,
            ) as ListItem[],
          }
        : {
            type: 'list',
            ordered: false,
            start: null,
            children: lowerSequence(
              element.children,
              'list',
              `${path}.children`,
            ) as ListItem[],
          }
      return node
    }
    case 'li': {
      requireOutputContext(element, context, 'list', path)
      assertAllowedProps(element, [], path)
      const node: ListItem = {
        type: 'listItem',
        children: lowerSequence(
          element.children,
          'block',
          `${path}.children`,
        ) as ListItem['children'],
      }
      return node
    }
    case 'br': {
      requireOutputContext(element, context, 'phrasing', path)
      assertAllowedProps(element, [], path)
      assertVoidChildren(element, path)
      const node: Break = {type: 'break'}
      return node
    }
    case 'hr': {
      requireOutputContext(element, context, 'flow', path)
      assertAllowedProps(element, [], path)
      assertVoidChildren(element, path)
      const node: ThematicBreak = {type: 'thematicBreak'}
      return node
    }
    case 'code': {
      requireOutputContext(element, context, 'phrasing', path)
      assertAllowedProps(element, [], path)
      const node: InlineCode = {
        type: 'inlineCode',
        value: collectCodeText(element.children, `${path}.children`),
      }
      return node
    }
    case 'pre': {
      requireOutputContext(element, context, 'flow', path)
      assertAllowedProps(element, [], path)
      const codeElement = requirePreCodeChild(
        element.children,
        `${path}.children`,
      )
      assertAllowedProps(codeElement, [], `${path}.children`)
      const node: Code = {
        type: 'code',
        value: collectCodeText(
          codeElement.children,
          `${path}.children.children`,
        ),
      }
      return node
    }
  }
}

function lowerPhrasingChildren(
  element: MarkElement,
  path: string,
  context: 'phrasing' | 'link' = 'phrasing',
): PhrasingContent[] {
  return lowerSequence(
    element.children,
    context,
    `${path}.children`,
  ) as PhrasingContent[]
}

function requireOutputContext(
  element: MarkElement,
  actual: LoweringContext,
  required: 'flow' | 'phrasing' | 'list',
  path: string,
): void {
  const valid =
    required === 'flow'
      ? actual === 'root' || actual === 'block'
      : required === 'phrasing'
        ? actual === 'phrasing' || actual === 'link'
        : actual === required
  if (!valid) {
    const nodeKind = required === 'flow' ? 'flow node' : `${required} node`
    runtimeError(
      'ERR1104',
      `${nodeKind} produced by <${element.name}> is invalid in ${actual} context`,
      {path, source: element.source},
    )
  }
}

function assertVoidChildren(element: MarkElement, path: string): void {
  if (!isRecursivelyEmpty(element.children)) {
    runtimeError('ERR1102', `<${element.name}> requires empty children`, {
      path,
      source: element.source,
    })
  }
}

function requirePreCodeChild(value: unknown, path: string): MarkElement {
  const children: unknown[] = []
  flattenNonEmpty(value, children)
  if (
    children.length !== 1 ||
    !isMarkElement(children[0]) ||
    children[0].name !== 'code'
  ) {
    runtimeError('ERR1104', '<pre> must contain exactly one <code> child', {
      path,
    })
  }
  return children[0]
}

function collectCodeText(value: unknown, path: string): string {
  let output = ''
  const append = (current: unknown, currentPath: string): void => {
    if (isEmptyValue(current)) return
    if (Array.isArray(current)) {
      for (const [index, child] of current.entries())
        append(child, `${currentPath}[${index}]`)
      return
    }
    if (isMarkFragment(current)) {
      append(current.children, `${currentPath}.children`)
      return
    }
    if (typeof current === 'string' || typeof current === 'number') {
      output += String(current)
      return
    }
    if (isMdastCandidate(current) && current.type === 'text') {
      validateNodeForContext(current, 'phrasing', currentPath)
      output += current.value as string
      return
    }
    runtimeError(
      'ERR1104',
      'code content may contain only strings, numbers, text nodes, arrays, and fragments',
      {path: currentPath},
    )
  }
  append(value, path)
  return output
}

function flattenNonEmpty(value: unknown, output: unknown[]): void {
  if (isEmptyValue(value)) return
  if (Array.isArray(value)) {
    for (const child of value) flattenNonEmpty(child, output)
    return
  }
  if (isMarkFragment(value)) {
    flattenNonEmpty(value.children, output)
    return
  }
  output.push(value)
}

function isRecursivelyEmpty(value: unknown): boolean {
  if (isEmptyValue(value)) return true
  if (Array.isArray(value)) return value.every(isRecursivelyEmpty)
  if (isMarkFragment(value)) return isRecursivelyEmpty(value.children)
  return false
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === false
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof (value as {then?: unknown}).then === 'function'
  )
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
