import type {Code, Root} from 'mdast'
import {
  type BundledLanguage,
  type BundledTheme,
  bundledLanguages,
  bundledLanguagesAlias,
  codeToTokens,
} from 'shiki'
import {docxData} from './tree.ts'
import type {DocxCodeData, DocxCodeToken} from './types.ts'

export interface CodeHighlightOptions {
  /** Shiki theme used to materialize token colors. */
  theme?: BundledTheme
  /** Language used for unlabelled fenced code blocks. */
  defaultLanguage?: BundledLanguage
  /** Map document-facing language names to Shiki bundled language names. */
  languages?: Readonly<Record<string, BundledLanguage>>
}

/** Adds plain, serializable Shiki tokens to fenced code nodes. */
export async function transformCodeHighlight(
  root: Root,
  options: CodeHighlightOptions = {},
): Promise<void> {
  const codeNodes: {node: Code; path: string}[] = []
  collectCode(root, '$', codeNodes)

  for (const {node, path} of codeNodes) {
    if (node.data?.docx?.code !== undefined) continue
    const requested = node.lang ?? options.defaultLanguage
    if (requested === undefined) continue
    const language = options.languages?.[requested] ?? requested
    if (!isSupportedLanguage(language)) continue
    const theme = options.theme ?? 'github-light'
    let highlighted: Awaited<ReturnType<typeof codeToTokens>>
    try {
      highlighted = await codeToTokens(node.value, {
        lang: language as BundledLanguage,
        theme,
      })
    } catch (error) {
      throw new Error(
        `${path}: could not highlight ${JSON.stringify(requested)} code for DOCX`,
        {cause: error},
      )
    }

    const code: DocxCodeData = {
      language,
      theme,
      lines: highlighted.tokens.map((line) =>
        line.map(
          (token): DocxCodeToken => ({
            content: token.content,
            ...(token.color === undefined ? {} : {color: token.color}),
            ...(token.fontStyle === undefined
              ? {}
              : {fontStyle: token.fontStyle}),
          }),
        ),
      ),
    }
    docxData(node).code = code
  }
}

function isSupportedLanguage(language: string): boolean {
  return (
    language === 'text' ||
    language === 'plaintext' ||
    language === 'txt' ||
    language in bundledLanguages ||
    language in bundledLanguagesAlias
  )
}

function collectCode(
  node: Root | Root['children'][number],
  path: string,
  output: {node: Code; path: string}[],
): void {
  if (node.type === 'code') output.push({node, path})
  if (!('children' in node) || !Array.isArray(node.children)) return
  for (const [index, child] of node.children.entries()) {
    collectCode(child, `${path}.children[${index}]`, output)
  }
}
