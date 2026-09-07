import remarkDirective from '@markscript/remark-mdx-directive'
import {tsPlugin} from '@sveltejs/acorn-typescript'
import {Parser} from 'acorn'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import {unified} from 'unified'
import {VFile} from 'vfile'
import type {MarkscriptNode} from './ast.ts'
import {markscriptDiagnostic} from './diagnostics.ts'
import type {Diagnostic} from './types.ts'

const TypeScriptParser = Parser.extend(tsPlugin({jsx: true}))

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective, {
    acorn: TypeScriptParser,
    acornOptions: {
      ecmaVersion: 'latest',
      locations: true,
      sourceType: 'module',
    },
    addResult: false,
  })
  .use(remarkMdx, {
    acorn: TypeScriptParser,
    acornOptions: {
      ecmaVersion: 'latest',
      locations: true,
      sourceType: 'module',
    },
    addResult: false,
  })

export interface ParseResult {
  tree?: MarkscriptNode
  diagnostics: Diagnostic[]
}

export function parseMarkscript(source: string, filename: string): ParseResult {
  const file = new VFile({path: filename, value: source})

  try {
    const tree = processor.parse(file) as MarkscriptNode
    normalizeMarkscriptJsx(tree)
    return {
      tree,
      diagnostics: [],
    }
  } catch (error) {
    const cause = error as {
      message?: string
      position?: {
        start?: {line?: number; column?: number}
        end?: {line?: number; column?: number}
      }
      line?: number
      column?: number
    }
    const line = cause.position?.start?.line ?? cause.line ?? 1
    const column = cause.position?.start?.column ?? cause.column ?? 1
    const endLine = cause.position?.end?.line ?? line
    const endColumn = cause.position?.end?.column ?? column

    return {
      diagnostics: [
        markscriptDiagnostic(
          'SYN1001',
          cause.message ?? String(error),
          filename,
          {
            start: {line, column},
            end: {line: endLine, column: endColumn},
          },
        ),
      ],
    }
  }
}

const flowIntrinsicNames = new Set([
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
  'li',
  'hr',
  'pre',
  'section',
  'div',
])

const phrasingContainerNames = new Set([
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
  'code',
])

function normalizeMarkscriptJsx(node: MarkscriptNode): void {
  if (!node.children) return

  node.children = node.children.map((child) => {
    normalizeMarkscriptJsx(child)
    if (
      child.type === 'paragraph' &&
      child.children?.length === 1 &&
      child.children[0]?.type === 'mdxJsxTextElement' &&
      isStandaloneDocumentElement(child.children[0])
    ) {
      const element = child.children[0]
      element.type = 'mdxJsxFlowElement'
      if (child.position) element.position = child.position
      return element
    }
    return child
  })

  if (
    node.type === 'mdxJsxFlowElement' &&
    node.name &&
    phrasingContainerNames.has(node.name) &&
    node.children.length === 1 &&
    node.children[0]?.type === 'paragraph'
  ) {
    node.children = node.children[0].children ?? []
  }

  // Upstream MDX wraps a multiline `<code>` child in a Markdown paragraph.
  // MarkScript's block-code constructor requires it to remain the one direct
  // child of `<pre>`.
  if (
    node.type === 'mdxJsxFlowElement' &&
    node.name === 'pre' &&
    node.children.length === 1 &&
    node.children[0]?.type === 'paragraph' &&
    node.children[0].children?.length === 1 &&
    (node.children[0].children[0]?.type === 'mdxJsxTextElement' ||
      node.children[0].children[0]?.type === 'mdxJsxFlowElement') &&
    node.children[0].children[0].name === 'code'
  ) {
    node.children = [node.children[0].children[0]]
  }
}

function isStandaloneDocumentElement(node: MarkscriptNode): boolean {
  const name = node.name
  return (
    typeof name === 'string' &&
    (flowIntrinsicNames.has(name) || /^[A-Z_$]/u.test(name))
  )
}
