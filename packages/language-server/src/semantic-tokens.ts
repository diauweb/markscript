import {
  type MarkscriptAttribute,
  type MarkscriptNode,
  parseMarkscript,
} from '@markscript/compiler'
import {
  type SemanticTokens,
  SemanticTokensBuilder,
  type SemanticTokensLegend,
} from '@volar/language-server/node'
import {closingMdxTagEndOffset, openingMdxTagEndOffset} from './mdx-source.ts'

// The first twelve entries deliberately match TypeScript's 2020 semantic
// classification order. Keep that prefix stable when adding token types.
export const semanticTokenTypes = [
  'class',
  'enum',
  'interface',
  'namespace',
  'typeParameter',
  'type',
  'parameter',
  'variable',
  'enumMember',
  'property',
  'function',
  'method',
  'macro',
  'decorator',
  'comment',
  'string',
  'keyword',
  'number',
  'regexp',
  'operator',
  'typescriptPunctuation',
  'markscriptPunctuation',
  'markdownHeading',
  'markdownEmphasis',
  'markdownStrong',
  'markdownStrikethrough',
  'markdownCode',
  'markdownLink',
  'markdownQuote',
  'markdownList',
  'markdownTable',
  'mdxTag',
  'mdxAttribute',
  'mdxExpression',
  'directive',
  'mdxTagDelimiter',
] as const

export type SemanticTokenType = (typeof semanticTokenTypes)[number]

export const semanticTokenModifiers = [
  'declaration',
  'static',
  'async',
  'readonly',
  'defaultLibrary',
  'local',
] as const

export interface SourceHighlightToken {
  start: number
  end: number
  type: SemanticTokenType
  modifiers?: number
  priority: number
}

interface LineHighlightToken {
  line: number
  start: number
  end: number
  type: SemanticTokenType
  modifiers: number
  priority: number
}

const priority = {
  container: 40,
  link: 70,
  heading: 90,
  emphasis: 110,
  strong: 120,
  code: 150,
  punctuation: 220,
  mdx: 340,
} as const

export function collectMarkscriptSyntaxTokens(
  source: string,
  filename: string,
): SourceHighlightToken[] {
  const tree = parseMarkscript(source, filename).tree
  if (!tree) return collectRecoverableMdxTokens(source)
  const tokens: SourceHighlightToken[] = []
  visit(tree, (node) => {
    collectNodeTokens(source, node, tokens)
    return true
  })
  return tokens
}

export function buildSemanticTokens(
  source: string,
  candidates: readonly SourceHighlightToken[],
): SemanticTokens {
  const selected = selectLineTokens(source, candidates)
  const builder = new SemanticTokensBuilder()
  for (const token of selected) {
    const type = semanticTokenTypes.indexOf(token.type)
    if (type < 0) continue
    builder.push(
      token.line,
      token.start,
      token.end - token.start,
      type,
      token.modifiers,
    )
  }
  return builder.build()
}

export function buildVolarSemanticTokens(
  source: string,
  candidates: readonly SourceHighlightToken[],
  legend: SemanticTokensLegend,
): Array<[number, number, number, number, number]> {
  return selectLineTokens(source, candidates).flatMap((token) => {
    const type = legend.tokenTypes.indexOf(token.type)
    return type < 0
      ? []
      : [
          [
            token.line,
            token.start,
            token.end - token.start,
            type,
            token.modifiers,
          ],
        ]
  })
}

function selectLineTokens(
  source: string,
  candidates: readonly SourceHighlightToken[],
): LineHighlightToken[] {
  const lineStarts = sourceLineStarts(source)
  const lines: LineHighlightToken[] = []
  for (const candidate of candidates) {
    if (
      candidate.start < 0 ||
      candidate.end <= candidate.start ||
      candidate.start >= source.length
    ) {
      continue
    }
    const end = Math.min(candidate.end, source.length)
    let line = lineAtOffset(lineStarts, candidate.start)
    while (line < lineStarts.length) {
      const lineStart = lineStarts[line]
      if (lineStart === undefined || lineStart >= end) break
      const nextLineStart = lineStarts[line + 1] ?? source.length
      const contentEnd =
        nextLineStart > lineStart && source.charCodeAt(nextLineStart - 1) === 10
          ? nextLineStart - 1
          : nextLineStart
      const start = Math.max(candidate.start, lineStart)
      const segmentEnd = Math.min(end, contentEnd)
      if (segmentEnd > start) {
        lines.push({
          line,
          start: start - lineStart,
          end: segmentEnd - lineStart,
          type: candidate.type,
          modifiers: candidate.modifiers ?? 0,
          priority: candidate.priority,
        })
      }
      line += 1
    }
  }

  lines.sort(
    (left, right) =>
      right.priority - left.priority ||
      left.end - left.start - (right.end - right.start) ||
      left.line - right.line ||
      left.start - right.start,
  )
  const occupied = new Map<number, Array<{start: number; end: number}>>()
  const selected: LineHighlightToken[] = []
  for (const token of lines) {
    const lineOccupied = occupied.get(token.line) ?? []
    let fragments = [{start: token.start, end: token.end}]
    for (const range of lineOccupied) {
      fragments = fragments.flatMap((fragment) => subtract(fragment, range))
      if (fragments.length === 0) break
    }
    for (const fragment of fragments) {
      if (fragment.end <= fragment.start) continue
      selected.push({...token, ...fragment})
      lineOccupied.push(fragment)
    }
    lineOccupied.sort((left, right) => left.start - right.start)
    occupied.set(token.line, lineOccupied)
  }

  selected.sort(
    (left, right) => left.line - right.line || left.start - right.start,
  )
  return selected
}

function collectNodeTokens(
  source: string,
  node: MarkscriptNode,
  tokens: SourceHighlightToken[],
): void {
  const range = nodeOffsets(node)
  if (!range) return
  const add = (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => addToken(tokens, start, end, type, tokenPriority)

  switch (node.type) {
    case 'heading':
      add(range.start, range.end, 'markdownHeading', priority.heading)
      addLinePrefix(source, range, /^(?: {0,3})(?:#{1,6})(?=\s|$)/u, add)
      break
    case 'emphasis':
      add(range.start, range.end, 'markdownEmphasis', priority.emphasis)
      addPairedDelimiters(source, range, 1, add)
      break
    case 'strong':
      add(range.start, range.end, 'markdownStrong', priority.strong)
      addPairedDelimiters(source, range, 2, add)
      break
    case 'delete':
      add(range.start, range.end, 'markdownStrikethrough', priority.strong)
      addPairedDelimiters(source, range, 2, add)
      break
    case 'inlineCode':
    case 'code':
      add(range.start, range.end, 'markdownCode', priority.code)
      addCodeDelimiters(source, range, node.type === 'code', add)
      break
    case 'link':
    case 'linkReference':
    case 'image':
    case 'imageReference':
    case 'definition':
      add(range.start, range.end, 'markdownLink', priority.link)
      addMarkdownPunctuation(source, range, /[![\]()]/gu, add)
      break
    case 'blockquote':
      add(range.start, range.end, 'markdownQuote', priority.container)
      addMarkdownPunctuation(source, range, /^(?: {0,3})>/gmu, add)
      break
    case 'list':
      addListMarkers(source, range, add)
      break
    case 'table':
    case 'tableRow':
    case 'tableCell':
      add(range.start, range.end, 'markdownTable', priority.container)
      if (node.type === 'table') {
        addMarkdownPunctuation(source, range, /[|:-]/gu, add)
      }
      break
    case 'thematicBreak':
      add(range.start, range.end, 'markscriptPunctuation', priority.punctuation)
      break
    case 'break':
      addMarkdownPunctuation(source, range, /(?:\\| {2})\n?$/u, add)
      break
    case 'mdxFlowExpression':
    case 'mdxTextExpression':
      addExpressionDelimiters(source, range, add)
      break
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement':
      addMdxElementTokens(source, node, range, add)
      break
    case 'html':
      add(range.start, range.end, 'mdxTag', priority.mdx)
      break
    case 'containerDirective':
    case 'leafDirective':
    case 'textDirective':
      add(range.start, range.end, 'directive', priority.mdx)
      addMarkdownPunctuation(source, range, /[:{}]|\[|\]/gu, add)
      break
  }
}

function addMdxElementTokens(
  source: string,
  node: MarkscriptNode,
  range: {start: number; end: number},
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
  forcedNameType?: SemanticTokenType,
): void {
  const name = node.name
  const openEnd = openingMdxTagEndOffset(source, node)
  if (openEnd === undefined) return
  add(range.start, range.start + 1, 'mdxTagDelimiter', priority.mdx)
  if (typeof name === 'string') {
    const nameStart = skipTagPrefix(source, range.start + 1, openEnd)
    add(
      nameStart,
      nameStart + name.length,
      forcedNameType ?? tagType(name),
      priority.mdx + 20,
    )
  }
  addTagEnd(source, openEnd, add)

  for (const attribute of node.attributes ?? []) {
    addMdxAttributeTokens(source, attribute, add)
  }

  if (typeof name !== 'string') {
    const closing = source.lastIndexOf('</>', range.end)
    if (closing > range.start && closing >= openEnd) {
      add(closing, closing + 3, 'mdxTagDelimiter', priority.mdx)
    }
    return
  }
  const closing = source.lastIndexOf(`</${name}`, range.end)
  if (closing <= range.start || closing < openEnd) return
  add(closing, closing + 2, 'mdxTagDelimiter', priority.mdx)
  add(
    closing + 2,
    closing + 2 + name.length,
    forcedNameType ?? tagType(name),
    priority.mdx + 20,
  )
  const closingEnd = closingMdxTagEndOffset(source, closing, range.end)
  if (closingEnd !== undefined) addTagEnd(source, closingEnd, add)
}

function addMdxAttributeTokens(
  source: string,
  attribute: MarkscriptAttribute,
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
): void {
  const range = positionOffsets(attribute.position)
  if (!range) return
  const value = source.slice(range.start, range.end)
  if (attribute.type === 'mdxJsxExpressionAttribute') {
    addExpressionDelimiters(source, range, add)
    return
  }
  const nameOffset = value.indexOf(attribute.name)
  if (nameOffset >= 0) {
    add(
      range.start + nameOffset,
      range.start + nameOffset + attribute.name.length,
      'mdxAttribute',
      priority.mdx + 10,
    )
  }
  const equals = value.indexOf(
    '=',
    Math.max(0, nameOffset + attribute.name.length),
  )
  if (equals < 0) return
  add(range.start + equals, range.start + equals + 1, 'operator', priority.mdx)
  const valueStart = equals + 1
  const rest = value.slice(valueStart)
  const leading = rest.search(/\S/u)
  if (leading < 0) return
  const absolute = range.start + valueStart + leading
  const first = source[absolute]
  if (first === '"' || first === "'") {
    add(absolute, range.end, 'string', priority.mdx)
  } else if (first === '{') {
    addExpressionDelimiters(source, {start: absolute, end: range.end}, add)
  }
}

function collectRecoverableMdxTokens(source: string): SourceHighlightToken[] {
  const tokens: SourceHighlightToken[] = []
  const pattern = /<\/?(?:x-[A-Za-z][\w-]*|[A-Za-z_$][\w$.-]*)/gu
  for (const match of source.matchAll(pattern)) {
    const value = match[0]
    if (!value) continue
    const slash = value.startsWith('</') ? 2 : 1
    const name = value.slice(slash)
    addToken(
      tokens,
      match.index,
      match.index + slash,
      'mdxTagDelimiter',
      priority.mdx,
    )
    addToken(
      tokens,
      match.index + slash,
      match.index + value.length,
      tagType(name),
      priority.mdx + 20,
    )
  }
  return tokens
}

function tagType(name: string): SemanticTokenType {
  return /^[A-Z_$]/u.test(name) ? 'macro' : 'mdxTag'
}

function addExpressionDelimiters(
  source: string,
  range: {start: number; end: number},
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
): void {
  if (source[range.start] === '{') {
    add(range.start, range.start + 1, 'mdxExpression', priority.mdx)
  }
  let end = range.end
  while (end > range.start && /\s/u.test(source[end - 1] ?? '')) end -= 1
  if (source[end - 1] === '}') {
    add(end - 1, end, 'mdxExpression', priority.mdx)
  }
}

function addLinePrefix(
  source: string,
  range: {start: number; end: number},
  pattern: RegExp,
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
): void {
  const match = pattern.exec(source.slice(range.start, range.end))
  if (match?.[0]) {
    add(
      range.start,
      range.start + match[0].length,
      'markscriptPunctuation',
      priority.punctuation,
    )
  }
}

function addPairedDelimiters(
  _source: string,
  range: {start: number; end: number},
  length: number,
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
): void {
  add(
    range.start,
    Math.min(range.end, range.start + length),
    'markscriptPunctuation',
    priority.punctuation,
  )
  add(
    Math.max(range.start, range.end - length),
    range.end,
    'markscriptPunctuation',
    priority.punctuation,
  )
}

function addCodeDelimiters(
  source: string,
  range: {start: number; end: number},
  block: boolean,
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
): void {
  const value = source.slice(range.start, range.end)
  if (!block) {
    const opening = /^`+/u.exec(value)?.[0].length ?? 0
    const closing = /`+$/u.exec(value)?.[0].length ?? 0
    if (opening > 0)
      add(
        range.start,
        range.start + opening,
        'markscriptPunctuation',
        priority.punctuation,
      )
    if (closing > 0)
      add(
        range.end - closing,
        range.end,
        'markscriptPunctuation',
        priority.punctuation,
      )
    return
  }
  for (const match of value.matchAll(/^(?: {0,3})(?:`{3,}|~{3,}).*$/gmu)) {
    add(
      range.start + match.index,
      range.start + match.index + (match[0]?.length ?? 0),
      'markscriptPunctuation',
      priority.punctuation,
    )
  }
}

function addListMarkers(
  source: string,
  range: {start: number; end: number},
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
): void {
  const value = source.slice(range.start, range.end)
  for (const match of value.matchAll(/^(?:\s*)(?:[-+*]|\d+[.)])(?=\s)/gmu)) {
    add(
      range.start + match.index,
      range.start + match.index + (match[0]?.length ?? 0),
      'markdownList',
      priority.punctuation,
    )
  }
}

function addMarkdownPunctuation(
  source: string,
  range: {start: number; end: number},
  pattern: RegExp,
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
): void {
  for (const match of source.slice(range.start, range.end).matchAll(pattern)) {
    if (!match[0]) continue
    add(
      range.start + match.index,
      range.start + match.index + match[0].length,
      'markscriptPunctuation',
      priority.punctuation,
    )
  }
}

function addTagEnd(
  source: string,
  end: number,
  add: (
    start: number,
    end: number,
    type: SemanticTokenType,
    tokenPriority: number,
  ) => void,
): void {
  const start = source[end - 1] === '/' ? end - 1 : end
  add(start, end + 1, 'mdxTagDelimiter', priority.mdx)
}

function skipTagPrefix(source: string, start: number, end: number): number {
  let offset = start
  if (source[offset] === '/') offset += 1
  while (offset < end && /\s/u.test(source[offset] ?? '')) offset += 1
  return offset
}

function addToken(
  tokens: SourceHighlightToken[],
  start: number,
  end: number,
  type: SemanticTokenType,
  tokenPriority: number,
): void {
  if (end > start) tokens.push({start, end, type, priority: tokenPriority})
}

function nodeOffsets(
  node: MarkscriptNode,
): {start: number; end: number} | undefined {
  return positionOffsets(node.position)
}

function positionOffsets(
  position: MarkscriptNode['position'] | MarkscriptAttribute['position'],
): {start: number; end: number} | undefined {
  const start = position?.start.offset
  const end = position?.end.offset
  return typeof start === 'number' && typeof end === 'number'
    ? {start, end}
    : undefined
}

function visit(
  node: MarkscriptNode,
  run: (node: MarkscriptNode) => boolean,
): void {
  if (!run(node)) return
  for (const child of node.children ?? []) visit(child, run)
}

function sourceLineStarts(source: string): number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function lineAtOffset(lineStarts: readonly number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const start = lineStarts[middle] ?? 0
    const next = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY
    if (offset < start) high = middle - 1
    else if (offset >= next) low = middle + 1
    else return middle
  }
  return Math.max(0, high)
}

function subtract(
  value: {start: number; end: number},
  occupied: {start: number; end: number},
): Array<{start: number; end: number}> {
  if (occupied.end <= value.start || occupied.start >= value.end) return [value]
  const result: Array<{start: number; end: number}> = []
  if (occupied.start > value.start) {
    result.push({start: value.start, end: occupied.start})
  }
  if (occupied.end < value.end) {
    result.push({start: occupied.end, end: value.end})
  }
  return result
}
