import ts from 'typescript'
import type {MarkscriptAttribute, MarkscriptNode, MdxAttribute} from './ast.ts'
import {markscriptDiagnostic} from './diagnostics.ts'
import type {Diagnostic, GeneratedSourceSpan} from './types.ts'

type ContentContext =
  | 'root'
  | 'flow'
  | 'phrasing'
  | 'link'
  | 'list'
  | 'table'
  | 'table-row'
  | 'pre'
  | 'code'
  | 'component'

interface DefinitionRecord {
  url: string
  title: string | null
}

interface GeneratorState {
  source: string
  filename: string
  diagnostics: Diagnostic[]
  definitions: Map<string, DefinitionRecord>
  jsx: string
  jsxs: string
  fragment: string
  execute: string
  directiveAnnotation: string
  directiveGroup: string
}

const allowedProps: Readonly<Record<string, ReadonlySet<string> | null>> = {
  h1: new Set(),
  h2: new Set(),
  h3: new Set(),
  h4: new Set(),
  h5: new Set(),
  h6: new Set(),
  p: new Set(),
  em: new Set(),
  strong: new Set(),
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
  blockquote: new Set(),
  ul: new Set(),
  ol: new Set(['start']),
  li: new Set(),
  br: new Set(),
  hr: new Set(),
  code: new Set(),
  pre: new Set(),
}

const phrasingIntrinsics = new Set(['em', 'strong', 'a', 'img', 'br', 'code'])

const flowIntrinsics = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'ul',
  'ol',
  'hr',
  'pre',
])

const phrasingMarkdownNodes = new Set([
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

const flowMarkdownNodes = new Set([
  'blockquote',
  'code',
  'definition',
  'footnoteDefinition',
  'heading',
  'html',
  'list',
  'paragraph',
  'table',
  'thematicBreak',
  'yaml',
  'containerDirective',
  'leafDirective',
])

export interface GeneratedModule {
  virtualCode: string
  virtualFilename: string
  spans: GeneratedSourceSpan[]
  diagnostics: Diagnostic[]
}

export function generateModule(
  tree: MarkscriptNode,
  source: string,
  filename: string,
): GeneratedModule {
  const suffix = uniqueInternalSuffix(
    hash(`${filename}\0${source.length}`),
    source,
  )
  const state: GeneratorState = {
    source,
    filename,
    diagnostics: [],
    definitions: collectDefinitions(tree),
    jsx: `__markscript_${suffix}_jsx`,
    jsxs: `__markscript_${suffix}_jsxs`,
    fragment: `__markscript_${suffix}_fragment`,
    execute: `__markscript_${suffix}_execute`,
    directiveAnnotation: `__markscript_${suffix}_directive_annotation`,
    directiveGroup: `__markscript_${suffix}_directive_group`,
  }
  const render = `__markscript_${suffix}_render`
  const entry = `__markscript_${suffix}_entry`
  const modules = collectModuleBlocks(tree)

  for (const moduleNode of modules) validateModuleBlock(moduleNode, state)
  validateTree(tree, 'root', state)

  const documentChildren = (tree.children ?? [])
    .filter((child) => child.type !== 'mdxjsEsm')
    .map((child) => emitNode(child, state))
    .filter((value): value is string => value !== undefined)

  const body = documentChildren.length
    ? `${state.jsxs}(${state.fragment}, {children: [${documentChildren.join(',\n')} ]})`
    : `${state.jsx}(${state.fragment}, {})`

  const virtualCode = [
    '/** @jsxImportSource @markscript/runtime */',
    `import {directiveAnnotation as ${state.directiveAnnotation}, directiveGroup as ${state.directiveGroup}, executeDocument as ${state.execute}} from '@markscript/runtime'`,
    `import {Fragment as ${state.fragment}, jsx as ${state.jsx}, jsxs as ${state.jsxs}} from '@markscript/runtime/jsx-runtime'`,
    ...modules.map((node) => node.value ?? ''),
    `async function ${render}() {`,
    `  return ${body}`,
    `}`,
    `async function ${entry}() {`,
    `  return ${state.execute}(${render})`,
    `}`,
    `export default ${entry}`,
    '',
  ].join('\n\n')

  return {
    virtualCode,
    virtualFilename: `${filename}.tsx`,
    spans: collectSourceSpans(
      virtualCode,
      tree,
      source,
      modules,
      render,
      state.jsx,
      state.jsxs,
    ),
    diagnostics: state.diagnostics,
  }
}

interface SourcePiece {
  value: string
  searchValue: string
  searchOffset: number
  sourceStart: number
  sourceEnd: number
  segments?: SourcePieceSegment[]
}

interface SourcePieceSegment {
  valueStart: number
  valueEnd: number
  sourceStart: number
  sourceEnd: number
}

function collectSourceSpans(
  virtualCode: string,
  tree: MarkscriptNode,
  source: string,
  modules: MarkscriptNode[],
  renderName: string,
  jsxName: string,
  jsxsName: string,
): GeneratedSourceSpan[] {
  const spans: GeneratedSourceSpan[] = []
  let moduleCursor = 0

  for (const node of modules) {
    const value = node.value ?? ''
    const sourceStart = sourceOffsetForValue(node, value, source)
    const generatedStart = virtualCode.indexOf(value, moduleCursor)
    if (value && sourceStart !== undefined && generatedStart >= 0) {
      spans.push({
        generatedStart,
        generatedEnd: generatedStart + value.length,
        sourceStart,
        sourceEnd: sourceStart + value.length,
      })
      moduleCursor = generatedStart + value.length
    }
  }

  const pieces: SourcePiece[] = []
  for (const child of tree.children ?? []) {
    collectSourcePieces(child, source, pieces, jsxName, jsxsName)
  }
  let documentCursor = Math.max(
    moduleCursor,
    virtualCode.indexOf(`async function ${renderName}`),
  )

  for (const piece of pieces) {
    const matchStart = virtualCode.indexOf(piece.searchValue, documentCursor)
    if (matchStart < 0) continue
    const generatedStart = matchStart + piece.searchOffset
    if (piece.segments) {
      for (const segment of piece.segments) {
        spans.push({
          generatedStart: generatedStart + segment.valueStart,
          generatedEnd: generatedStart + segment.valueEnd,
          sourceStart: segment.sourceStart,
          sourceEnd: segment.sourceEnd,
        })
      }
    } else {
      spans.push({
        generatedStart,
        generatedEnd: generatedStart + piece.value.length,
        sourceStart: piece.sourceStart,
        sourceEnd: piece.sourceEnd,
      })
    }
    documentCursor = generatedStart + piece.value.length
  }

  return spans.sort((left, right) => left.generatedStart - right.generatedStart)
}

function collectSourcePieces(
  node: MarkscriptNode,
  source: string,
  pieces: SourcePiece[],
  jsxName: string,
  jsxsName: string,
) {
  if (node.type === 'mdxjsEsm') return
  if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
    pushNodePiece(node, node.value ?? '', source, pieces, 'expression')
    return
  }

  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    pushJsxCallPiece(node, source, pieces, jsxName, jsxsName)
  }

  if (
    node.type === 'containerDirective' ||
    node.type === 'leafDirective' ||
    node.type === 'textDirective'
  ) {
    for (const attribute of node.directiveAttributes ?? []) {
      if (attribute.type === 'mdxJsxExpressionAttribute') {
        pushPositionPiece(
          attribute.position,
          attribute.value,
          source,
          pieces,
          'spread',
        )
      } else if (
        typeof attribute.value === 'object' &&
        attribute.value !== null
      ) {
        pushPositionPiece(
          attribute.position,
          attribute.value.value,
          source,
          pieces,
          'expression',
        )
      }
    }
  }

  for (const child of node.children ?? []) {
    collectSourcePieces(child, source, pieces, jsxName, jsxsName)
  }
}

function pushJsxCallPiece(
  node: MarkscriptNode,
  source: string,
  pieces: SourcePiece[],
  jsxName: string,
  jsxsName: string,
): void {
  const start = node.position?.start.offset
  if (start === undefined) return
  const runtimeName = (node.children?.length ?? 0) > 1 ? jsxsName : jsxName
  const typeExpression =
    node.name === null || node.name === undefined
      ? undefined
      : /^[a-z]/u.test(node.name) || node.name.includes('-')
        ? JSON.stringify(node.name)
        : node.name
  if (typeExpression === undefined) return

  pieces.push({
    value: runtimeName,
    searchValue: `${runtimeName}(${typeExpression}, {`,
    searchOffset: 0,
    sourceStart: start,
    sourceEnd: Math.min(source.length, start + 1),
  })

  if (node.name && /^[A-Z_$]/u.test(node.name)) {
    pushNodePiece(node, node.name, source, pieces, 'name')
  }

  const attributeStart = node.attributes?.[0]?.position?.start.offset
  const tagEnd = source.slice(start, node.position?.end.offset).search(/\/?>/u)
  const propsEnd = attributeStart ?? (tagEnd >= 0 ? start + tagEnd : undefined)
  if (propsEnd !== undefined) {
    const propsStart = Math.min(propsEnd, start + 1 + (node.name?.length ?? 0))
    pieces.push({
      value: '',
      searchValue: ', {',
      searchOffset: 3,
      sourceStart: propsStart,
      sourceEnd: propsEnd,
    })
  }

  for (const attribute of node.attributes ?? []) {
    if (attribute.type === 'mdxJsxExpressionAttribute') {
      pushPositionPiece(
        attribute.position,
        attribute.value,
        source,
        pieces,
        'spread',
      )
      continue
    }

    const attributePosition = attribute.position?.start.offset
    if (attributePosition !== undefined) {
      pieces.push({
        value: attribute.name,
        searchValue: `[${JSON.stringify(attribute.name)}]`,
        searchOffset: 2,
        sourceStart: attributePosition,
        sourceEnd: attributePosition + attribute.name.length,
      })
    }
    if (typeof attribute.value === 'object' && attribute.value !== null) {
      pushPositionPiece(
        attribute.position,
        attribute.value.value,
        source,
        pieces,
        'expression',
      )
    }
  }
}

function pushNodePiece(
  node: MarkscriptNode,
  value: string,
  source: string,
  pieces: SourcePiece[],
  kind: 'expression' | 'name',
) {
  if (kind === 'expression') {
    pushExpressionPiece(node.position, value, source, pieces)
    return
  }
  const sourceStart = sourceOffsetForValue(node, value, source)
  if (value && sourceStart !== undefined) {
    pieces.push({
      value,
      searchValue: `${value}, {`,
      searchOffset: 0,
      sourceStart,
      sourceEnd: sourceStart + value.length,
    })
  }
}

function pushPositionPiece(
  position: MarkscriptAttribute['position'],
  value: string,
  source: string,
  pieces: SourcePiece[],
  kind: 'expression' | 'spread',
) {
  const start = position?.start.offset
  const end = position?.end.offset
  const mappedValue = kind === 'spread' ? spreadExpression(value) : value
  if (!mappedValue || start === undefined || end === undefined) return
  if (kind === 'expression') {
    pushExpressionPiece(position, mappedValue, source, pieces)
    return
  }
  const sourceStart = source.indexOf(mappedValue, start)
  if (sourceStart < start || sourceStart + mappedValue.length > end) return
  pieces.push({
    value: mappedValue,
    searchValue: mappedValue,
    searchOffset: 0,
    sourceStart,
    sourceEnd: sourceStart + mappedValue.length,
  })
}

function pushExpressionPiece(
  position: MarkscriptNode['position'] | MarkscriptAttribute['position'],
  value: string,
  source: string,
  pieces: SourcePiece[],
): void {
  const start = position?.start.offset
  const end = position?.end.offset
  if (!value || start === undefined || end === undefined) return
  const segments: SourcePieceSegment[] = []
  let valueCursor = 0
  let sourceCursor = start
  for (const line of value.split('\n')) {
    const valueStart = valueCursor
    valueCursor += line.length + 1
    if (!line.trim()) continue
    const sourceStart = source.indexOf(line, sourceCursor)
    if (sourceStart < sourceCursor || sourceStart + line.length > end) return
    segments.push({
      valueStart,
      valueEnd: valueStart + line.length,
      sourceStart,
      sourceEnd: sourceStart + line.length,
    })
    sourceCursor = sourceStart + line.length
  }
  if (segments.length === 0) return
  pieces.push({
    value,
    searchValue: `(\n${value}\n)`,
    searchOffset: 2,
    sourceStart: segments[0]?.sourceStart ?? start,
    sourceEnd: segments.at(-1)?.sourceEnd ?? end,
    segments,
  })
}

function sourceOffsetForValue(
  node: MarkscriptNode,
  value: string,
  source: string,
): number | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return undefined
  const relative = source.slice(start, end).indexOf(value)
  return relative < 0 ? undefined : start + relative
}

function collectModuleBlocks(tree: MarkscriptNode): MarkscriptNode[] {
  return (tree.children ?? []).filter((node) => node.type === 'mdxjsEsm')
}

function collectDefinitions(
  tree: MarkscriptNode,
): Map<string, DefinitionRecord> {
  const definitions = new Map<string, DefinitionRecord>()

  visit(tree, (node) => {
    if (
      node.type === 'definition' &&
      typeof node.identifier === 'string' &&
      typeof node.url === 'string'
    ) {
      definitions.set(normalizeIdentifier(node.identifier), {
        url: node.url,
        title: typeof node.title === 'string' ? node.title : null,
      })
    }
  })

  return definitions
}

function visit(node: MarkscriptNode, callback: (node: MarkscriptNode) => void) {
  callback(node)
  for (const child of node.children ?? []) visit(child, callback)
}

function validateModuleBlock(node: MarkscriptNode, state: GeneratorState) {
  const moduleSource = node.value ?? ''
  const parsed = ts.createSourceFile(
    state.filename,
    moduleSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  for (const statement of parsed.statements) {
    const isDefault =
      ts.isExportAssignment(statement) ||
      (ts.canHaveModifiers(statement) &&
        ts
          .getModifiers(statement)
          ?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
          )) ||
      (ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ((ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.some(
            (element) => element.name.text === 'default',
          )) ||
          (ts.isNamespaceExport(statement.exportClause) &&
            statement.exportClause.name.text === 'default')))

    if (isDefault) {
      state.diagnostics.push(
        markscriptDiagnostic(
          'ERR1201',
          'The default export is reserved for the generated MarkScript document entry. Use a named export instead.',
          state.filename,
          node.position,
        ),
      )
    }
  }

  if (containsUnscopedAwait(parsed)) {
    state.diagnostics.push(
      markscriptDiagnostic(
        'ERR1003',
        'MarkScript rejects top-level await. Return the promise from a document expression or await it inside an async function.',
        state.filename,
        node.position,
      ),
    )
  }
}

function containsUnscopedAwait(root: ts.Node): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (node !== root && ts.isFunctionLike(node)) return
    if (
      ts.isAwaitExpression(node) ||
      (ts.isForOfStatement(node) && node.awaitModifier !== undefined)
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function expressionContainsTopLevelAwait(value: string): boolean {
  const expression = spreadExpression(value)
  if (isTriviaOnly(expression)) return false
  const sourceFile = ts.createSourceFile(
    'markscript-expression.tsx',
    `const __markscript_expression = (${expression})`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  return containsUnscopedAwait(sourceFile)
}

function validateTree(
  node: MarkscriptNode,
  context: ContentContext,
  state: GeneratorState,
) {
  if (
    (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') &&
    expressionContainsTopLevelAwait(node.value ?? '')
  ) {
    state.diagnostics.push(
      markscriptDiagnostic(
        'ERR1003',
        'MarkScript rejects explicit top-level await in a document expression. Return the promise directly; MarkScript awaits the expression implicitly.',
        state.filename,
        node.position,
      ),
    )
  }

  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    validateJsxElement(node, context, state)
    return
  }

  if (!isMarkdownNodeAllowed(node.type, context)) {
    state.diagnostics.push(
      markscriptDiagnostic(
        'ERR1104',
        `Markdown node \`${node.type}\` is invalid in ${context} content.`,
        state.filename,
        node.position,
      ),
    )
  }

  const childContext = contextForMarkdownNode(node, context)
  if (
    (node.type === 'leafDirective' || node.type === 'textDirective') &&
    (node.children?.length ?? 0) > 0
  ) {
    state.diagnostics.push(
      markscriptDiagnostic(
        'ERR1111',
        `${node.type === 'leafDirective' ? 'Leaf' : 'inline'} directive :${node.name ?? ''} is a zero-width attacher and cannot have a label.`,
        state.filename,
        node.position,
      ),
    )
  }
  if (
    node.type === 'containerDirective' ||
    node.type === 'leafDirective' ||
    node.type === 'textDirective'
  ) {
    for (const attribute of node.directiveAttributes ?? []) {
      const expression =
        attribute.type === 'mdxJsxExpressionAttribute'
          ? attribute.value
          : typeof attribute.value === 'object' && attribute.value !== null
            ? attribute.value.value
            : undefined
      if (
        expression !== undefined &&
        expressionContainsTopLevelAwait(expression)
      ) {
        state.diagnostics.push(
          markscriptDiagnostic(
            'ERR1003',
            'MarkScript rejects explicit top-level await in a directive attribute expression. Return the promise directly; MarkScript awaits the expression implicitly.',
            state.filename,
            attribute.position,
          ),
        )
      }
    }
  }
  for (const child of node.children ?? []) {
    validateTree(child, childContext, state)
  }
}

function isMarkdownNodeAllowed(type: string, context: ContentContext): boolean {
  if (context === 'component') return true
  if (type === 'mdxFlowExpression' || type === 'mdxTextExpression') return true
  if (type === 'root') return context === 'root'
  if (type === 'mdxjsEsm') return context === 'flow'
  if (context === 'root' || context === 'flow') {
    return flowMarkdownNodes.has(type)
  }
  if (context === 'phrasing') return phrasingMarkdownNodes.has(type)
  if (context === 'link') {
    return (
      type !== 'link' &&
      type !== 'linkReference' &&
      phrasingMarkdownNodes.has(type)
    )
  }
  if (context === 'list') return type === 'listItem'
  if (context === 'table') return type === 'tableRow'
  if (context === 'table-row') return type === 'tableCell'
  if (context === 'code') return type === 'text'
  return false
}

function validateJsxElement(
  node: MarkscriptNode,
  context: ContentContext,
  state: GeneratorState,
) {
  const name = node.name

  for (const attribute of node.attributes ?? []) {
    const expression =
      attribute.type === 'mdxJsxExpressionAttribute'
        ? attribute.value
        : typeof attribute.value === 'object' && attribute.value !== null
          ? attribute.value.value
          : undefined
    if (
      expression !== undefined &&
      expressionContainsTopLevelAwait(expression)
    ) {
      state.diagnostics.push(
        markscriptDiagnostic(
          'ERR1003',
          'MarkScript rejects explicit top-level await in a JSX attribute expression. Return the promise directly; MarkScript awaits the expression implicitly.',
          state.filename,
          attribute.position,
        ),
      )
    }
  }

  if (name === null || name === undefined) {
    for (const child of node.children ?? []) validateTree(child, context, state)
    return
  }

  if (name.includes(':')) {
    state.diagnostics.push(
      markscriptDiagnostic(
        'ERR1101',
        `JSX name <${name}> is unsupported. Use a Markdown intrinsic, an uppercase component, or a directive attacher.`,
        state.filename,
        node.position,
      ),
    )
    return
  }

  const props = allowedProps[name]
  const isLowercase = /^[a-z]/u.test(name)
  const isIntrinsic = props !== undefined
  if (isLowercase && !isIntrinsic) {
    state.diagnostics.push(
      markscriptDiagnostic(
        'ERR1101',
        `JSX intrinsic <${name}> lies outside MarkScript's Markdown vocabulary.`,
        state.filename,
        node.position,
      ),
    )
  }

  if (isIntrinsic) {
    if (props !== null) {
      for (const attribute of node.attributes ?? []) {
        if (
          attribute.type === 'mdxJsxAttribute' &&
          !props.has(attribute.name)
        ) {
          state.diagnostics.push(
            markscriptDiagnostic(
              'ERR1102',
              `Attribute \`${attribute.name}\` is invalid on <${name}>. Attach metadata with a directive or use a component.`,
              state.filename,
              node.position,
            ),
          )
        }
      }
    }

    if (!isIntrinsicAllowed(name, context)) {
      state.diagnostics.push(
        markscriptDiagnostic(
          'ERR1104',
          `JSX intrinsic <${name}> is invalid in ${context} content.`,
          state.filename,
          node.position,
        ),
      )
    }

    if (name === 'pre' && !hasValidStaticPreChild(node)) {
      state.diagnostics.push(
        markscriptDiagnostic(
          'ERR1104',
          '<pre> must contain exactly one direct <code> child (or one dynamic expression that produces it).',
          state.filename,
          node.position,
        ),
      )
    }
  }

  const childContext = isIntrinsic ? contextForIntrinsic(name) : 'component'
  for (const child of node.children ?? []) {
    validateTree(child, childContext, state)
  }
}

function isIntrinsicAllowed(name: string, context: ContentContext): boolean {
  if (context === 'component') return true
  if (context === 'phrasing') return phrasingIntrinsics.has(name)
  if (context === 'link') return name !== 'a' && phrasingIntrinsics.has(name)
  if (context === 'list') return name === 'li'
  if (context === 'pre') return name === 'code'
  if (context === 'code') return false
  if (name === 'li') return false
  return flowIntrinsics.has(name) || phrasingIntrinsics.has(name)
}

function contextForIntrinsic(name: string): ContentContext {
  if (
    name === 'h1' ||
    name === 'h2' ||
    name === 'h3' ||
    name === 'h4' ||
    name === 'h5' ||
    name === 'h6' ||
    name === 'p' ||
    name === 'em' ||
    name === 'strong' ||
    name === 'a' ||
    name === 'div' ||
    name === 'span'
  ) {
    return name === 'a' ? 'link' : 'phrasing'
  }
  if (name === 'ul' || name === 'ol') return 'list'
  if (name === 'pre') return 'pre'
  if (name === 'code') return 'code'
  return 'flow'
}

function hasValidStaticPreChild(node: MarkscriptNode): boolean {
  const children = node.children ?? []
  if (children.length !== 1) return false
  const child = children[0]
  return (
    child?.type === 'mdxFlowExpression' ||
    child?.type === 'mdxTextExpression' ||
    ((child?.type === 'mdxJsxFlowElement' ||
      child?.type === 'mdxJsxTextElement') &&
      child.name === 'code')
  )
}

function contextForMarkdownNode(
  node: MarkscriptNode,
  fallback: ContentContext,
): ContentContext {
  if (
    node.type === 'paragraph' ||
    node.type === 'heading' ||
    node.type === 'emphasis' ||
    node.type === 'strong' ||
    node.type === 'link' ||
    node.type === 'linkReference'
  ) {
    return node.type === 'link' || node.type === 'linkReference'
      ? 'link'
      : 'phrasing'
  }
  if (node.type === 'list') return 'list'
  if (node.type === 'table') return 'table'
  if (node.type === 'tableRow') return 'table-row'
  if (node.type === 'tableCell') return 'phrasing'
  if (node.type === 'leafDirective' || node.type === 'textDirective') {
    return 'phrasing'
  }
  if (node.type === 'containerDirective') return 'flow'
  if (
    node.type === 'root' ||
    node.type === 'blockquote' ||
    node.type === 'listItem'
  ) {
    return 'flow'
  }
  return fallback
}

function emitNode(
  node: MarkscriptNode,
  state: GeneratorState,
): string | undefined {
  if (isStaticMdastNode(node)) return JSON.stringify(node)

  switch (node.type) {
    case 'text':
      return JSON.stringify(node.value ?? '')
    case 'paragraph':
      return emitElement('p', {}, node.children ?? [], state)
    case 'heading':
      return emitElement(`h${node.depth ?? 1}`, {}, node.children ?? [], state)
    case 'emphasis':
      return emitElement('em', {}, node.children ?? [], state)
    case 'strong':
      return emitElement('strong', {}, node.children ?? [], state)
    case 'link':
      return emitElement(
        'a',
        {href: node.url ?? '', title: node.title ?? undefined},
        node.children ?? [],
        state,
      )
    case 'image':
      return emitElement(
        'img',
        {
          src: node.url ?? '',
          alt: node.alt ?? '',
          title: node.title ?? undefined,
        },
        [],
        state,
      )
    case 'blockquote':
      return emitElement('blockquote', {}, node.children ?? [], state)
    case 'list':
      return emitElement(
        node.ordered ? 'ol' : 'ul',
        node.ordered && node.start !== null && node.start !== undefined
          ? {start: node.start}
          : {},
        node.children ?? [],
        state,
      )
    case 'listItem':
      return emitElement('li', {}, node.children ?? [], state)
    case 'break':
      return emitElement('br', {}, [], state)
    case 'thematicBreak':
      return emitElement('hr', {}, [], state)
    case 'inlineCode':
      return emitElement(
        'code',
        {},
        [{type: 'text', value: node.value ?? ''}],
        state,
      )
    case 'code':
      return objectLiteral({
        type: 'code',
        lang: node.lang ?? undefined,
        meta: node.meta ?? undefined,
        value: node.value ?? '',
      })
    case 'html':
      return objectLiteral({type: 'html', value: node.value ?? ''})
    case 'containerDirective':
    case 'leafDirective':
    case 'textDirective':
      return emitDirective(node, state)
    case 'definition':
      return undefined
    case 'linkReference': {
      const definition = definitionFor(node, state)
      if (!definition) return JSON.stringify(`[${plainText(node)}]`)
      return emitElement(
        'a',
        {href: definition.url, title: definition.title ?? undefined},
        node.children ?? [],
        state,
      )
    }
    case 'imageReference': {
      const definition = definitionFor(node, state)
      if (!definition) return JSON.stringify(node.alt ?? '')
      return emitElement(
        'img',
        {
          src: definition.url,
          alt: node.alt ?? '',
          title: definition.title ?? undefined,
        },
        [],
        state,
      )
    }
    case 'mdxFlowExpression':
    case 'mdxTextExpression':
      return emitExpression(node.value ?? '')
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement':
      return emitMdxElement(node, state)
    case 'mdxjsEsm':
      return undefined
    default:
      state.diagnostics.push(
        markscriptDiagnostic(
          'ERR1002',
          `Markdown node \`${node.type}\` is unsupported by the MarkScript compiler.`,
          state.filename,
          node.position,
        ),
      )
      return 'undefined'
  }
}

function emitDirective(node: MarkscriptNode, state: GeneratorState): string {
  const parsedAttributes = node.attributes as unknown
  const attributes =
    typeof parsedAttributes === 'object' &&
    parsedAttributes !== null &&
    !Array.isArray(parsedAttributes)
      ? (parsedAttributes as Record<string, unknown>)
      : {}
  const props =
    node.directiveAttributes === undefined
      ? JSON.stringify(attributes)
      : `{${node.directiveAttributes.map(emitAttribute).join(', ')}}`
  const name = JSON.stringify(node.name ?? '')
  if (node.type !== 'containerDirective') {
    return `${state.directiveAnnotation}(${name}, ${props})`
  }
  const children = (node.children ?? [])
    .map((child) => emitNode(child, state))
    .filter((value): value is string => value !== undefined)
  const body =
    children.length === 0
      ? '[]'
      : children.length === 1
        ? children[0]
        : `[${children.join(', ')}]`
  return `${state.directiveGroup}(${name}, ${props}, ${body})`
}

function isStaticMdastNode(node: MarkscriptNode): boolean {
  if (
    node.type === 'root' ||
    node.type.startsWith('mdx') ||
    node.type === 'containerDirective' ||
    node.type === 'leafDirective' ||
    node.type === 'textDirective'
  ) {
    return false
  }
  return (node.children ?? []).every(isStaticMdastNode)
}

function emitElement(
  name: string,
  props: Record<string, unknown>,
  children: MarkscriptNode[],
  state: GeneratorState,
): string {
  const entries = Object.entries(props)
    .filter((entry) => entry[1] !== undefined)
    .map(([key, value]) => `[${JSON.stringify(key)}]: ${JSON.stringify(value)}`)
  const emittedChildren = children
    .map((child) => emitNode(child, state))
    .filter((value): value is string => value !== undefined)

  if (emittedChildren.length === 1) {
    entries.push(`children: ${emittedChildren[0]}`)
  } else if (emittedChildren.length > 1) {
    entries.push(`children: [${emittedChildren.join(', ')}]`)
  }

  const runtimeFunction = emittedChildren.length > 1 ? state.jsxs : state.jsx
  return `${runtimeFunction}(${JSON.stringify(name)}, {${entries.join(', ')}})`
}

function emitMdxElement(node: MarkscriptNode, state: GeneratorState): string {
  const name = node.name
  const typeExpression =
    name === null || name === undefined
      ? state.fragment
      : /^[a-z]/u.test(name) || name.includes('-')
        ? JSON.stringify(name)
        : /^[A-Z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u.test(name)
          ? name
          : 'undefined'
  const entries = (node.attributes ?? []).map((attribute) =>
    emitAttribute(attribute),
  )
  const children = (node.children ?? [])
    .map((child) => emitNode(child, state))
    .filter((value): value is string => value !== undefined)

  if (children.length === 1) entries.push(`children: ${children[0]}`)
  if (children.length > 1) entries.push(`children: [${children.join(', ')}]`)

  const runtimeFunction = children.length > 1 ? state.jsxs : state.jsx
  return `${runtimeFunction}(${typeExpression}, {${entries.join(', ')}})`
}

function emitAttribute(attribute: MarkscriptAttribute): string {
  if (attribute.type === 'mdxJsxExpressionAttribute') {
    return `...(await (${spreadExpression(attribute.value)}))`
  }

  return `[${JSON.stringify(attribute.name)}]: ${emitAttributeValue(attribute)}`
}

function emitAttributeValue(attribute: MdxAttribute): string {
  if (attribute.value === null) return 'true'
  if (typeof attribute.value === 'string')
    return JSON.stringify(attribute.value)
  return emitExpression(attribute.value.value)
}

function emitExpression(value: string): string {
  if (isTriviaOnly(value)) return 'undefined'
  return `(await (\n${value}\n))`
}

function spreadExpression(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('...') ? trimmed.slice(3).trim() : trimmed
}

function isTriviaOnly(value: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.JSX,
    value,
  )

  while (true) {
    const token = scanner.scan()
    if (token === ts.SyntaxKind.EndOfFileToken) return true
    if (
      token !== ts.SyntaxKind.WhitespaceTrivia &&
      token !== ts.SyntaxKind.NewLineTrivia &&
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia &&
      token !== ts.SyntaxKind.ShebangTrivia
    ) {
      return false
    }
  }
}

function definitionFor(
  node: MarkscriptNode,
  state: GeneratorState,
): DefinitionRecord | undefined {
  return typeof node.identifier === 'string'
    ? state.definitions.get(normalizeIdentifier(node.identifier))
    : undefined
}

function normalizeIdentifier(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLowerCase()
}

function plainText(node: MarkscriptNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(plainText).join('')
}

function objectLiteral(value: Record<string, unknown>): string {
  const entries = Object.entries(value)
    .filter((entry) => entry[1] !== undefined)
    .map(([key, item]) => `[${JSON.stringify(key)}]: ${JSON.stringify(item)}`)
  return `({${entries.join(', ')}})`
}

function hash(value: string): string {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}

function uniqueInternalSuffix(initial: string, source: string): string {
  let suffix = initial
  while (source.includes(`__markscript_${suffix}_`)) suffix += '_x'
  return suffix
}
