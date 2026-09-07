import {
  type AstPath,
  type Doc,
  doc,
  type ParserOptions,
  type Plugin,
  type Printer,
} from 'prettier'
import {parsers as babelParsers} from 'prettier/plugins/babel'
import {printers as markdownPrinters} from 'prettier/plugins/markdown'
import type {MarkscriptAttribute, MarkscriptNode} from './ast.ts'
import {parseMarkscript} from './parser.ts'

const {hardline, join, group, indent, lineSuffixBoundary} = doc.builders
const markdown = markdownPrinters.mdast as Printer<MarkscriptNode>
const customTypes = new Set([
  'textDirective',
  'leafDirective',
  'containerDirective',
  'mdxjsEsm',
  'mdxTextExpression',
  'mdxFlowExpression',
  'mdxJsxTextElement',
  'mdxJsxFlowElement',
])

function markdownOptions<T extends object>(options: T): T {
  return {...options, parser: 'markdown'}
}

const printer: Printer<MarkscriptNode> = {
  ...markdown,
  async preprocess(tree, options) {
    return wrapInlineNodes(
      (await markdown.preprocess?.(tree, markdownOptions(options))) ?? tree,
    )
  },
  getVisitorKeys(node) {
    if (customTypes.has(node.type)) return node.children ? ['children'] : []
    return markdown.getVisitorKeys?.(node, new Set()) ?? []
  },
  print(path, options, print) {
    if (path.node.type === 'esComment') {
      return doc.utils.replaceEndOfLine(
        ['{/* ', path.node.value ?? '', ' */}'],
        hardline,
      )
    }
    if (customTypes.has(path.node.type)) {
      return options.originalText.slice(
        offsetStart(path.node),
        offsetEnd(path.node),
      )
    }
    return markdown.print(
      path,
      markdownOptions(
        isFlowDirectiveLabel(path)
          ? {...options, proseWrap: 'never'}
          : isInlineBoundaryWhitespace(path)
            ? {...options, proseWrap: 'preserve'}
            : options,
      ),
      print,
    )
  },
  embed(path, options) {
    const node = path.node as MarkscriptNode
    if (
      node.type === 'code' &&
      ['ms', 'markscript', 'mdx'].includes(node.lang?.toLowerCase() ?? '')
    ) {
      return async (textToDoc) => {
        const body = await textToDoc(node.value ?? '', {
          ...options,
          parser: 'markscript',
          filepath: 'example.ms',
        })
        const formatted = doc.printer.printDocToString(body, {
          printWidth: options.printWidth ?? 80,
          tabWidth: options.tabWidth ?? 2,
          useTabs: options.useTabs ?? false,
        }).formatted
        const runs = formatted.match(/`+/g) ?? []
        const fence = '`'.repeat(
          Math.max(3, ...runs.map((run) => run.length + 1)),
        )
        return [
          fence,
          node.lang ?? '',
          node.meta ? ` ${node.meta}` : '',
          hardline,
          body,
          hardline,
          fence,
        ]
      }
    }
    if (!customTypes.has(node.type))
      return markdown.embed?.(path, markdownOptions(options)) ?? null
    return async (textToDoc, print) => {
      const source = (options as ParserOptions<MarkscriptNode>).originalText
      const start = offsetStart(node)
      const end = offsetEnd(node)
      const inTable = hasAncestor(path, 'tableCell')
      const singleLine =
        inTable ||
        hasAncestor(path, 'heading') ||
        isFlowDirectiveLabel(path) ||
        node.type === 'mdxTextExpression'
      const embeddedOptions = {
        ...options,
        filepath: 'expression.tsx',
        ...(singleLine ? {printWidth: Infinity} : {}),
      }
      const expression = async (value: string): Promise<Doc> => {
        const printed = await textToDoc(value, {
          ...embeddedOptions,
          parser: 'markscript-expression',
        })
        if (!singleLine || value.includes('\n')) return printed
        const text = doc.printer.printDocToString(printed, {
          printWidth: Infinity,
          tabWidth: options.tabWidth ?? 2,
          useTabs: options.useTabs ?? false,
        }).formatted
        if (inTable && text.includes('|')) return value
        if (!text.includes('\n')) return text
        return value
      }
      if (node.type === 'mdxjsEsm') {
        return textToDoc(node.value ?? '', {
          ...embeddedOptions,
          parser: 'typescript',
        })
      }
      if (
        node.type === 'mdxTextExpression' ||
        node.type === 'mdxFlowExpression'
      ) {
        const value = node.value?.trim() ?? ''
        if (!value || /^(?:\/\*[\s\S]*\*\/|\/\/[^\n]*)$/.test(value)) {
          return doc.utils.replaceEndOfLine(
            ['{', node.value ?? '', '}'],
            hardline,
          )
        }
        const contents = await expression(node.value ?? '')
        return group(['{', indent(contents), lineSuffixBoundary, '}'])
      }

      const isDirective = node.type.endsWith('Directive')
      const attributes = isDirective
        ? node.directiveAttributes
        : node.attributes
      const children = node.children ?? []
      const label =
        node.type === 'containerDirective' && children[0]?.data?.directiveLabel
          ? children[0]
          : undefined
      const printedAttributes = await Promise.all(
        (attributes ?? []).map((attribute) =>
          printAttribute(attribute, expression),
        ),
      )
      const attributeDoc = printedAttributes.length
        ? [
            isDirective ? '{' : ' ',
            join(' ', printedAttributes),
            isDirective ? '}' : '',
          ]
        : ''
      const printedChildren = path.map(print, 'children')
      if (isDirective) {
        const fence =
          node.type === 'containerDirective'
            ? ':'.repeat(containerFenceSize(node, source))
            : node.type === 'leafDirective'
              ? '::'
              : ':'
        const labelDoc = label
          ? printedChildren[0]
          : node.type !== 'containerDirective' && children.length > 0
            ? printedChildren
            : undefined
        const header: Doc = [
          fence,
          node.name ?? '',
          labelDoc === undefined ? '' : ['[', labelDoc, ']'],
          attributeDoc,
        ]
        if (node.type !== 'containerDirective') return header
        const body = printedChildren.slice(label ? 1 : 0)
        return [
          header,
          hardline,
          ...(body.length ? [join([hardline, hardline], body), hardline] : []),
          fence,
        ]
      }
      const selfClosing =
        Boolean(node.name) && /\/\s*>$/.test(source.slice(start, end))
      const header: Doc = [
        '<',
        node.name ?? '',
        attributeDoc,
        selfClosing ? ' />' : '>',
      ]
      if (selfClosing) return header
      const closing = ['</', node.name ?? '', '>']
      const body = path.map(print, 'children')
      const block = children.some((child) => blockTypes.has(child.type))
      const opening = source.slice(start, offsetStart(children[0] ?? node))
      const flow =
        node.type === 'mdxJsxFlowElement' && />\s*\n\s*$/.test(opening)
      return block || flow
        ? [
            header,
            hardline,
            block ? join([hardline, hardline], body) : body,
            hardline,
            closing,
          ]
        : [header, body, closing]
    }
  },
}

function wrapInlineNodes(node: MarkscriptNode): MarkscriptNode {
  if (node.children) node.children = node.children.map(wrapInlineNodes)
  if (
    node.type === 'textDirective' ||
    node.type === 'mdxTextExpression' ||
    node.type === 'mdxJsxTextElement'
  ) {
    // Markdown's sentence nodes keep custom phrasing inside inline containers.
    return {
      type: 'sentence',
      children: [node],
      ...(node.position ? {position: node.position} : {}),
    }
  }
  return node
}

function hasAncestor(path: AstPath<MarkscriptNode>, type: string): boolean {
  for (let depth = 0; ; depth += 1) {
    const ancestor = path.getParentNode(depth)
    if (!ancestor) return false
    if (ancestor.type === type) return true
  }
}

function isFlowDirectiveLabel(path: AstPath<MarkscriptNode>): boolean {
  let child = path.node
  for (let depth = 0; ; depth += 1) {
    const parent = path.getParentNode(depth)
    if (!parent) return false
    if (parent.type === 'leafDirective') return true
    if (parent.type === 'containerDirective')
      return child.data?.directiveLabel === true
    child = parent
  }
}

function isInlineBoundaryWhitespace(path: AstPath<MarkscriptNode>): boolean {
  if (path.node.type !== 'whitespace') return false
  const sentence = path.getParentNode()
  const siblings = path.getParentNode(1)?.children
  if (sentence?.type !== 'sentence' || !siblings) return false
  const index = siblings.indexOf(sentence)
  const isInline = (node: MarkscriptNode | undefined) =>
    node?.type === 'esComment' ||
    (node?.type === 'sentence' &&
      customTypes.has(node.children?.[0]?.type ?? ''))
  return (
    (sentence.children?.[0] === path.node && isInline(siblings[index - 1])) ||
    (sentence.children?.at(-1) === path.node && isInline(siblings[index + 1]))
  )
}

const blockTypes = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'code',
  'table',
  'thematicBreak',
  'leafDirective',
  'containerDirective',
  'mdxJsxFlowElement',
  'mdxFlowExpression',
])

function containerFenceSize(node: MarkscriptNode, source: string): number {
  const nested = Math.max(
    0,
    ...(node.children ?? []).map((child) => containerFenceSize(child, source)),
  )
  return node.type === 'containerDirective'
    ? Math.max(
        3,
        source.slice(offsetStart(node)).match(/^:+/)?.[0].length ?? 0,
        nested + 1,
      )
    : nested
}

async function printAttribute(
  attribute: MarkscriptAttribute,
  expression: (value: string) => Promise<Doc>,
): Promise<Doc> {
  if (attribute.type === 'mdxJsxExpressionAttribute') {
    return expression(`{${attribute.value}}`)
  }
  if (typeof attribute.value === 'object' && attribute.value !== null) {
    return group([
      attribute.name,
      '={',
      indent(await expression(attribute.value.value)),
      lineSuffixBoundary,
      '}',
    ])
  }
  return attribute.value === null
    ? attribute.name
    : [attribute.name, '="', escapeAttributeValue(attribute.value), '"']
}

function escapeAttributeValue(value: string): string {
  return value.replace(
    /[&"|\\\r\n\t]/g,
    (character) => `&#${character.charCodeAt(0)};`,
  )
}

function offsetStart(node: {position?: MarkscriptNode['position']}): number {
  return node.position?.start.offset ?? 0
}

function offsetEnd(node: {position?: MarkscriptNode['position']}): number {
  return node.position?.end.offset ?? 0
}

function prepareForPrinting(node: MarkscriptNode): MarkscriptNode {
  if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
    const comment = node.value?.trim().match(/^\/\*([\s\S]*?)\*\/$/)
    if (comment && !comment[1]?.includes('*/')) {
      const printedComment = {
        ...node,
        type: 'esComment',
        value: comment[1]?.trim() ?? '',
      }
      return node.type === 'mdxFlowExpression'
        ? {...node, type: 'paragraph', children: [printedComment]}
        : printedComment
    }
  }
  if (node.children) node.children = node.children.map(prepareForPrinting)
  return node
}

export const languages = [
  {
    name: 'MarkScript',
    parsers: ['markscript'],
    extensions: ['.ms'],
    vscodeLanguageIds: ['markscript'],
  },
]
export const parsers: NonNullable<Plugin<MarkscriptNode>['parsers']> = {
  'markscript-expression': {
    ...babelParsers['babel-ts'],
    preprocess: (source) => `(\n${source}\n)`,
    async parse(source, options) {
      const parsed = await babelParsers['babel-ts'].parse(source, options)
      return {
        type: 'JsExpressionRoot',
        node: parsed.program.body[0].expression,
        comments: parsed.comments,
        range: [0, source.length],
      }
    },
  },
  markscript: {
    astFormat: 'markscript',
    parse(source, options) {
      const result = parseMarkscript(source, options.filepath ?? 'document.ms')
      if (!result.tree) throw new SyntaxError(result.diagnostics[0]?.message)
      return prepareForPrinting(result.tree)
    },
    locStart: offsetStart,
    locEnd: offsetEnd,
  },
}
export const printers = {markscript: printer}
export const defaultOptions = {semi: false, singleQuote: true}
const plugin: Plugin<MarkscriptNode> = {
  languages,
  parsers,
  printers,
  defaultOptions,
}
export default plugin
