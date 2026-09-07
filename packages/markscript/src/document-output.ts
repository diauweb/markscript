import type {ManualDocument} from '@markscript/manuals'
import type {Nodes, Root} from 'mdast'
import {frontmatterToMarkdown} from 'mdast-util-frontmatter'
import {gfmToMarkdown} from 'mdast-util-gfm'
import {toMarkdown} from 'mdast-util-to-markdown'

const ESCAPE = '\u001B['
const RESET = `${ESCAPE}0m`

interface InlineStyle {
  readonly bold?: boolean
  readonly dim?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  readonly strike?: boolean
  readonly color?: number
}

interface InlineSegment {
  readonly text: string
  readonly style: InlineStyle
  readonly break?: boolean
}

interface Prefix {
  readonly text: string
  readonly width: number
}

interface RenderContext {
  readonly width: number
  readonly color: boolean
  readonly indent: string
}

export const DOCUMENT_OUTPUT_FORMATS = ['markdown', 'mdast', 'pretty'] as const

export type DocumentOutputFormat = (typeof DOCUMENT_OUTPUT_FORMATS)[number]

export interface TerminalDocumentOptions {
  readonly color?: boolean
  readonly width?: number
  readonly accentColor?: number
}

export interface ManualReferenceOptions extends TerminalDocumentOptions {
  readonly terminal?: boolean
}

export class MarkScriptDocumentFormattingError extends Error {
  readonly code = 'ERR2101' as const
  readonly format: string

  constructor(
    format: string,
    cause: unknown,
    message = `Failed to format the finalized document as ${format}${
      cause instanceof Error ? `: ${cause.message}` : ''
    }`,
  ) {
    super(message, {cause})
    this.name = 'MarkScriptDocumentFormattingError'
    this.format = format
  }
}

export function parseDocumentOutputFormat(value: string): DocumentOutputFormat {
  if (DOCUMENT_OUTPUT_FORMATS.some((format) => format === value)) {
    return value as DocumentOutputFormat
  }
  const message = `Unknown output format ${JSON.stringify(value)}. Expected markdown, mdast, or pretty.`
  throw new MarkScriptDocumentFormattingError(value, undefined, message)
}

export function formatDocument(
  root: Root,
  format: DocumentOutputFormat,
  options: TerminalDocumentOptions = {},
): string {
  try {
    switch (format) {
      case 'markdown':
        return toMarkdown(root, {
          extensions: [gfmToMarkdown(), frontmatterToMarkdown(['yaml'])],
        }).trimEnd()
      case 'mdast':
        return requireSerializedJson(JSON.stringify(root, undefined, 2))
      case 'pretty':
        return renderTerminalDocument(root, options)
    }
  } catch (error) {
    throw new MarkScriptDocumentFormattingError(format, error)
  }
}

function requireSerializedJson(value: string | undefined): string {
  if (value === undefined) {
    throw new Error('JSON serialization produced no output')
  }
  return value
}

export function renderTerminalDocument(
  root: Root,
  options: TerminalDocumentOptions = {},
): string {
  const width = Math.max(40, Math.min(options.width ?? terminalWidth(), 100))
  const color = options.color ?? terminalColorEnabled()
  const renderer = new TerminalMarkdownRenderer(
    width,
    color,
    options.accentColor ?? 36,
  )
  return renderer.render(root)
}

/**
 * Formats the same parsed manual document for a person at a terminal or a
 * program reading stdout. The non-terminal branch appends the authored manual
 * location to Markdown serialized from the same MDAST.
 */
export function formatManualReference(
  manual: ManualDocument,
  markdown: string,
  options: ManualReferenceOptions = {},
): string {
  const terminal = options.terminal ?? process.stdout.isTTY === true
  if (!terminal) {
    const separator = markdown.endsWith('\n') ? '\n' : '\n\n'
    return `${markdown}${separator}Documentation: ${manual.documentationUrl}`
  }

  const color = options.color ?? terminalColorEnabled()
  const document = renderTerminalDocument(manual.root, {
    ...options,
    color,
    accentColor: manualAccentColor(manual),
  })
  const label = paint('MANUAL', {bold: true, color: 36}, color)
  const location = paint(
    manual.documentationUrl,
    {color: 36, underline: true},
    color,
  )
  return `${document}\n\n${label}  ${location}`
}

class TerminalMarkdownRenderer {
  readonly #width: number
  readonly #color: boolean
  readonly #accentColor: number

  constructor(width: number, color: boolean, accentColor: number) {
    this.#width = width
    this.#color = color
    this.#accentColor = accentColor
  }

  render(root: Nodes): string {
    const context: RenderContext = {
      width: this.#width,
      color: this.#color,
      indent: '',
    }
    return this.#renderBlocks(childrenOf(root), context).join('\n')
  }

  #renderBlocks(nodes: readonly Nodes[], context: RenderContext): string[] {
    const output: string[] = []
    for (const node of nodes) {
      const lines = this.#renderBlock(node, context)
      if (lines.length === 0) continue
      if (output.length > 0 && output.at(-1) !== '') output.push('')
      output.push(...lines)
    }
    return output
  }

  #renderBlock(node: Nodes, context: RenderContext): string[] {
    switch (node.type) {
      case 'root':
        return this.#renderBlocks(node.children, context)
      case 'heading':
        return this.#renderHeading(node, context)
      case 'paragraph':
        return wrapInline(inlineSegments(node.children), {
          width: context.width,
          firstPrefix: plainPrefix(context.indent),
          continuationPrefix: plainPrefix(context.indent),
          color: context.color,
        })
      case 'blockquote':
        return this.#renderBlockquote(node, context)
      case 'list':
        return this.#renderList(node, context)
      case 'code':
        return this.#renderCode(node.value, node.lang ?? undefined, context)
      case 'thematicBreak':
        return [
          paint(
            `${context.indent}${'─'.repeat(Math.max(8, context.width - context.indent.length))}`,
            {dim: true, color: 36},
            context.color,
          ),
        ]
      case 'html':
      case 'yaml':
        return this.#renderCode(node.value, node.type, context)
      case 'table':
        return this.#renderTable(node, context)
      case 'footnoteDefinition': {
        const marker = paint(
          `${context.indent}[${node.identifier}]`,
          {bold: true, color: 36},
          context.color,
        )
        const body = this.#renderBlocks(node.children, {
          ...context,
          width: context.width - 3,
          indent: `${context.indent}   `,
        })
        return [marker, ...body]
      }
      case 'definition':
        return []
      default: {
        const segments = inlineSegments([node])
        if (segments.length === 0) return []
        return wrapInline(segments, {
          width: context.width,
          firstPrefix: plainPrefix(context.indent),
          continuationPrefix: plainPrefix(context.indent),
          color: context.color,
        })
      }
    }
  }

  #renderHeading(
    node: Extract<Nodes, {type: 'heading'}>,
    context: RenderContext,
  ): string[] {
    const baseStyle: InlineStyle = {
      bold: true,
      ...(node.depth === 1 ? {color: this.#accentColor} : {}),
      ...(node.depth === 2 ? {color: 36} : {}),
      ...(node.depth > 2 ? {underline: true} : {}),
    }
    const marker = node.depth === 1 ? '' : node.depth === 2 ? '◆ ' : '▸ '
    const prefix = styledPrefix(
      `${context.indent}${marker}`,
      marker.length + context.indent.length,
      {bold: true, ...(node.depth === 2 ? {color: 36} : {})},
      context.color,
    )
    const segments = inlineSegments(node.children).map((segment) => ({
      ...segment,
      style: mergeStyle(segment.style, baseStyle),
    }))
    const lines = wrapInline(segments, {
      width: context.width,
      firstPrefix: prefix,
      continuationPrefix: plainPrefix(
        `${context.indent}${' '.repeat(marker.length)}`,
      ),
      color: context.color,
    })

    if (node.depth === 1) {
      const ruleWidth = Math.min(
        Math.max(12, visibleWidth(lines[0] ?? '')),
        context.width,
      )
      lines.push(
        paint(
          `${context.indent}${'━'.repeat(ruleWidth)}`,
          {dim: true, color: this.#accentColor},
          context.color,
        ),
      )
    }
    return lines
  }

  #renderBlockquote(
    node: Extract<Nodes, {type: 'blockquote'}>,
    context: RenderContext,
  ): string[] {
    const content = this.#renderBlocks(node.children, {
      ...context,
      width: Math.max(20, context.width - 2),
      indent: '',
    })
    const border = paint('│', {bold: true, color: 36}, context.color)
    return content.map((line) =>
      line === ''
        ? `${context.indent}${border}`
        : `${context.indent}${border} ${line}`,
    )
  }

  #renderList(
    node: Extract<Nodes, {type: 'list'}>,
    context: RenderContext,
  ): string[] {
    const output: string[] = []
    const start = node.start ?? 1

    for (const [index, item] of node.children.entries()) {
      const ordinal = node.ordered ? `${start + index}.` : '•'
      const checkbox =
        item.checked === true ? '[✓] ' : item.checked === false ? '[ ] ' : ''
      const marker = `${ordinal} ${checkbox}`
      const continuationIndent = `${context.indent}${' '.repeat(visibleWidth(marker))}`
      const [first, ...rest] = item.children
      if (first?.type === 'paragraph') {
        output.push(
          ...wrapInline(inlineSegments(first.children), {
            width: context.width,
            firstPrefix: styledPrefix(
              `${context.indent}${marker}`,
              context.indent.length + visibleWidth(marker),
              {bold: true, color: 36},
              context.color,
            ),
            continuationPrefix: plainPrefix(continuationIndent),
            color: context.color,
          }),
        )
      } else if (first !== undefined) {
        const firstLines = this.#renderBlock(first, {
          ...context,
          width: context.width - visibleWidth(marker),
          indent: continuationIndent,
        })
        if (firstLines[0] !== undefined) {
          firstLines[0] = `${paint(
            `${context.indent}${marker}`,
            {bold: true, color: 36},
            context.color,
          )}${firstLines[0].slice(continuationIndent.length)}`
        }
        output.push(...firstLines)
      }

      for (const child of rest) {
        if (node.spread || child.type !== 'list') output.push('')
        output.push(
          ...this.#renderBlock(child, {
            ...context,
            width: Math.max(20, context.width - visibleWidth(marker)),
            indent: continuationIndent,
          }),
        )
      }
      if (node.spread && index < node.children.length - 1) output.push('')
    }
    return output
  }

  #renderCode(
    value: string,
    language: string | undefined,
    context: RenderContext,
  ): string[] {
    const borderStyle = {dim: true, color: 36} satisfies InlineStyle
    const top = `${context.indent}${paint('╭─', borderStyle, context.color)}${
      language
        ? ` ${paint(language, {bold: true, color: 36}, context.color)}`
        : ''
    }`
    const content = value
      .split('\n')
      .map(
        (line) =>
          `${context.indent}${paint('│', borderStyle, context.color)} ${paint(
            line,
            {color: 90},
            context.color,
          )}`,
      )
    const bottom = `${context.indent}${paint('╰─', borderStyle, context.color)}`
    return [top, ...content, bottom]
  }

  #renderTable(
    node: Extract<Nodes, {type: 'table'}>,
    context: RenderContext,
  ): string[] {
    const rows = node.children.map((row) =>
      row.children.map((cell) => plainText(cell).trim()),
    )
    const columnCount = Math.max(0, ...rows.map((row) => row.length))
    const widths = Array.from({length: columnCount}, (_, column) =>
      Math.max(1, ...rows.map((row) => visibleWidth(row[column] ?? ''))),
    )
    const lines: string[] = []
    for (const [rowIndex, row] of rows.entries()) {
      const cells = widths.map((width, column) =>
        (row[column] ?? '').padEnd(width),
      )
      lines.push(`${context.indent}│ ${cells.join(' │ ')} │`)
      if (rowIndex === 0) {
        lines.push(
          paint(
            `${context.indent}├─${widths.map((width) => '─'.repeat(width)).join('─┼─')}─┤`,
            {dim: true, color: 36},
            context.color,
          ),
        )
      }
    }
    return lines
  }
}

function inlineSegments(
  nodes: readonly Nodes[],
  inherited: InlineStyle = {},
): InlineSegment[] {
  const output: InlineSegment[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        output.push({text: node.value, style: inherited})
        break
      case 'inlineCode':
        output.push({
          text: node.value,
          style: mergeStyle(inherited, {bold: true, color: 33}),
        })
        break
      case 'emphasis':
        output.push(
          ...inlineSegments(
            node.children,
            mergeStyle(inherited, {italic: true}),
          ),
        )
        break
      case 'strong':
        output.push(
          ...inlineSegments(node.children, mergeStyle(inherited, {bold: true})),
        )
        break
      case 'delete':
        output.push(
          ...inlineSegments(
            node.children,
            mergeStyle(inherited, {strike: true}),
          ),
        )
        break
      case 'link': {
        const label = plainText(node)
        output.push(
          ...inlineSegments(
            node.children,
            mergeStyle(inherited, {color: 36, underline: true}),
          ),
        )
        if (label !== node.url) {
          output.push({
            text: ` (${node.url})`,
            style: mergeStyle(inherited, {dim: true, color: 36}),
          })
        }
        break
      }
      case 'linkReference':
        output.push(
          ...inlineSegments(
            node.children,
            mergeStyle(inherited, {color: 36, underline: true}),
          ),
          {
            text: ` [${node.identifier}]`,
            style: mergeStyle(inherited, {dim: true, color: 36}),
          },
        )
        break
      case 'image':
        output.push({
          text: `[image: ${node.alt || node.url}]`,
          style: mergeStyle(inherited, {italic: true, color: 36}),
        })
        break
      case 'imageReference':
        output.push({
          text: `[image: ${node.alt || node.identifier}]`,
          style: mergeStyle(inherited, {italic: true, color: 36}),
        })
        break
      case 'footnoteReference':
        output.push({
          text: `[${node.identifier}]`,
          style: mergeStyle(inherited, {bold: true, color: 36}),
        })
        break
      case 'break':
        output.push({text: '', style: inherited, break: true})
        break
      case 'html':
        output.push({
          text: node.value,
          style: mergeStyle(inherited, {dim: true}),
        })
        break
      default: {
        const children = childrenOf(node)
        if (children.length > 0) {
          output.push(...inlineSegments(children, inherited))
        } else {
          const value = literalValue(node)
          if (value !== undefined) output.push({text: value, style: inherited})
        }
      }
    }
  }
  return output
}

function wrapInline(
  segments: readonly InlineSegment[],
  options: {
    readonly width: number
    readonly firstPrefix: Prefix
    readonly continuationPrefix: Prefix
    readonly color: boolean
  },
): string[] {
  const lines: string[] = []
  let prefix = options.firstPrefix
  let line = prefix.text
  let column = prefix.width
  let hasContent = false
  let pendingSpace = false

  const flush = (): void => {
    lines.push(line.trimEnd())
    prefix = options.continuationPrefix
    line = prefix.text
    column = prefix.width
    hasContent = false
    pendingSpace = false
  }

  for (const segment of segments) {
    if (segment.break) {
      flush()
      continue
    }
    const pieces = segment.text.split(/(\s+)/u)
    for (const piece of pieces) {
      if (piece === '') continue
      if (/^\s+$/u.test(piece)) {
        pendingSpace = hasContent
        continue
      }
      const pieceWidth = visibleWidth(piece)
      const spacing = pendingSpace && hasContent ? 1 : 0
      if (
        hasContent &&
        column + spacing + pieceWidth >
          Math.max(prefix.width + 8, options.width)
      ) {
        flush()
      }
      if (pendingSpace && hasContent) {
        line += ' '
        column += 1
      }
      line += paint(piece, segment.style, options.color)
      column += pieceWidth
      hasContent = true
      pendingSpace = false
    }
  }

  if (hasContent || lines.length === 0) lines.push(line.trimEnd())
  return lines
}

function paint(text: string, style: InlineStyle, color: boolean): string {
  if (!color || text === '') return text
  const codes: number[] = []
  if (style.bold) codes.push(1)
  if (style.dim) codes.push(2)
  if (style.italic) codes.push(3)
  if (style.underline) codes.push(4)
  if (style.strike) codes.push(9)
  if (style.color !== undefined) codes.push(style.color)
  return codes.length === 0
    ? text
    : `${ESCAPE}${codes.join(';')}m${text}${RESET}`
}

function mergeStyle(base: InlineStyle, additional: InlineStyle): InlineStyle {
  return {...base, ...additional}
}

function plainPrefix(text: string): Prefix {
  return {text, width: visibleWidth(text)}
}

function styledPrefix(
  text: string,
  width: number,
  style: InlineStyle,
  color: boolean,
): Prefix {
  return {text: paint(text, style, color), width}
}

function manualAccentColor(manual: ManualDocument): number {
  if (manual.kind === 'page' && manual.category === 'diagnostics') {
    if (manual.diagnosticKind === 'error') return 31
    if (manual.diagnosticKind === 'suggestion') return 32
    return 35
  }
  if (manual.category === 'tutorials') return 32
  if (manual.category === 'handbooks') return 36
  return 35
}

function childrenOf(node: Nodes): readonly Nodes[] {
  return 'children' in node && Array.isArray(node.children)
    ? (node.children as Nodes[])
    : []
}

function literalValue(node: Nodes): string | undefined {
  return 'value' in node && typeof node.value === 'string'
    ? node.value
    : undefined
}

function plainText(node: Nodes): string {
  const value = literalValue(node)
  if (value !== undefined) return value
  if ('alt' in node && typeof node.alt === 'string') return node.alt
  return childrenOf(node).map(plainText).join('')
}

function visibleWidth(value: string): number {
  let visible = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === '[') {
      index += 2
      while (index < value.length) {
        const code = value.charCodeAt(index)
        if (code >= 64 && code <= 126) break
        index += 1
      }
      continue
    }
    visible += value[index]
  }
  return Array.from(visible).length
}

function terminalWidth(): number {
  return typeof process.stdout.columns === 'number'
    ? process.stdout.columns
    : 80
}

function terminalColorEnabled(): boolean {
  return (
    process.stdout.isTTY === true &&
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== 'dumb'
  )
}
