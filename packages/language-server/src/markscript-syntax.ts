import {type MarkscriptNode, parseMarkscript} from '@markscript/compiler'
import {
  CompletionItemKind,
  type CompletionList,
  type Hover,
  MarkupKind,
  type Position,
  type Range,
} from '@volar/language-server/node'

interface SourceDocument {
  getText(): string
  offsetAt(position: Position): number
}

const intrinsicTags = new Map<
  string,
  {description: string; attributes: string[]}
>([
  ['h1', {description: 'Level-one Markdown heading.', attributes: []}],
  ['h2', {description: 'Level-two Markdown heading.', attributes: []}],
  ['h3', {description: 'Level-three Markdown heading.', attributes: []}],
  ['h4', {description: 'Level-four Markdown heading.', attributes: []}],
  ['h5', {description: 'Level-five Markdown heading.', attributes: []}],
  ['h6', {description: 'Level-six Markdown heading.', attributes: []}],
  ['p', {description: 'Markdown paragraph.', attributes: []}],
  ['blockquote', {description: 'Markdown block quote.', attributes: []}],
  ['ul', {description: 'Unordered Markdown list.', attributes: []}],
  ['ol', {description: 'Ordered Markdown list.', attributes: ['start']}],
  ['li', {description: 'Markdown list item.', attributes: []}],
  ['hr', {description: 'Markdown thematic break.', attributes: []}],
  ['pre', {description: 'Block-code container.', attributes: []}],
  ['em', {description: 'Emphasized Markdown phrasing.', attributes: []}],
  ['strong', {description: 'Strong Markdown phrasing.', attributes: []}],
  ['a', {description: 'Markdown link.', attributes: ['href', 'title']}],
  [
    'img',
    {description: 'Markdown image.', attributes: ['src', 'alt', 'title']},
  ],
  ['br', {description: 'Markdown line break.', attributes: []}],
  ['code', {description: 'Inline or block code content.', attributes: []}],
])

export class MarkscriptSyntaxService {
  readonly #source: string
  readonly #nodes: MarkscriptNode[] = []

  constructor(
    private readonly document: SourceDocument,
    filename: string,
  ) {
    this.#source = document.getText()
    const tree = parseMarkscript(this.#source, filename).tree
    if (!tree) return
    visit(tree, (node) => {
      this.#nodes.push(node)
      return true
    })
  }

  completion(position: Position): CompletionList | undefined {
    const offset = this.document.offsetAt(position)
    const before = this.#source.slice(0, offset)
    const tagNameMatch = /<(\/?)((?:[A-Za-z_$][\w$.-]*)?)$/u.exec(before)
    if (tagNameMatch) {
      const closing = tagNameMatch[1] === '/'
      const prefix = tagNameMatch[2] ?? ''
      const nearest = closing
        ? nearestOpenTag(before.slice(0, -(tagNameMatch[0]?.length ?? 0)))
        : undefined
      const names = closing
        ? nearest
          ? [nearest]
          : []
        : [...intrinsicTags.keys()]
      return {
        isIncomplete: false,
        items: names
          .filter((name) => name.startsWith(prefix))
          .map((name) => {
            const detail = closing
              ? 'Close the nearest open MarkScript tag'
              : intrinsicTags.get(name)?.description
            return {
              label: name,
              kind: CompletionItemKind.Keyword,
              ...(detail ? {detail} : {}),
            }
          }),
      }
    }

    const attributeMatch = /<([a-z][\w-]*)\s+[^<>]*?([A-Za-z-]*)$/u.exec(before)
    if (!attributeMatch) return undefined
    const name = attributeMatch[1] ?? ''
    const prefix = attributeMatch[2] ?? ''
    const openingTag = attributeMatch[0] ?? ''
    return {
      isIncomplete: false,
      items: (intrinsicTags.get(name)?.attributes ?? [])
        .filter(
          (attribute) =>
            attribute.startsWith(prefix) &&
            !new RegExp(`\\b${escapeRegExp(attribute)}\\s*=`, 'u').test(
              openingTag,
            ),
        )
        .map((attribute) => ({
          label: attribute,
          kind: CompletionItemKind.Property,
          detail: `<${name}> attribute`,
        })),
    }
  }

  hover(position: Position): Hover | undefined {
    const tag = this.#tagAt(position)
    if (!tag) return undefined
    const intrinsic = intrinsicTags.get(tag.name)
    const value = intrinsic
      ? `<${tag.name}>\n\n${intrinsic.description}`
      : undefined
    return value
      ? {contents: {kind: MarkupKind.PlainText, value}, range: tag.range}
      : undefined
  }

  #tagAt(position: Position): {name: string; range: Range} | undefined {
    for (const node of this.#nodes) {
      if (
        node.type !== 'mdxJsxFlowElement' &&
        node.type !== 'mdxJsxTextElement'
      )
        continue
      if (typeof node.name !== 'string') continue
      const range = tagNameRange(node, this.#source)
      if (range && contains(range, position)) return {name: node.name, range}
    }
    return undefined
  }
}

function visit(
  node: MarkscriptNode,
  callback: (node: MarkscriptNode) => boolean,
): void {
  if (!callback(node)) return
  for (const child of node.children ?? []) visit(child, callback)
}

function tagNameRange(node: MarkscriptNode, source: string): Range | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined || typeof node.name !== 'string')
    return undefined
  const relative = source.slice(start, end).indexOf(node.name)
  return relative < 0
    ? undefined
    : offsetRange(source, start + relative, start + relative + node.name.length)
}

function offsetRange(source: string, start: number, end: number): Range {
  return {start: positionAt(source, start), end: positionAt(source, end)}
}

function positionAt(source: string, offset: number): Position {
  let line = 0
  let lineStart = 0
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return {line, character: offset - lineStart}
}

function contains(range: Range, position: Position): boolean {
  const compare = (left: Position, right: Position) =>
    left.line === right.line
      ? left.character - right.character
      : left.line - right.line
  return (
    compare(position, range.start) >= 0 && compare(position, range.end) <= 0
  )
}

function nearestOpenTag(source: string): string | undefined {
  const stack: string[] = []
  const pattern = /<(\/)?([A-Za-z_$][\w$.-]*)(?:\s[^<>]*?)?(\/?)>/gu
  for (const match of source.matchAll(pattern)) {
    const name = match[2]
    if (!name || match[3] === '/') continue
    if (match[1] === '/') {
      const index = stack.lastIndexOf(name)
      if (index >= 0) stack.splice(index, 1)
    } else {
      stack.push(name)
    }
  }
  return stack.at(-1)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
