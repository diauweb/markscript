import {beforeAll, describe, expect, test} from 'bun:test'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {loadWASM, OnigScanner, OnigString} from 'vscode-oniguruma'
import {
  type IGrammar,
  INITIAL,
  type IRawGrammar,
  parseRawGrammar,
  Registry,
} from 'vscode-textmate'

const require = createRequire(import.meta.url)
const grammarPath = path.resolve(
  import.meta.dir,
  '../syntaxes/markscript.tmLanguage.json',
)
let grammar: IGrammar

beforeAll(async () => {
  const wasm = await readFile(
    require.resolve('vscode-oniguruma/release/onig.wasm'),
  )
  await loadWASM(
    wasm.buffer.slice(
      wasm.byteOffset,
      wasm.byteOffset + wasm.byteLength,
    ) as ArrayBuffer,
  )
  const markscript = parseRawGrammar(
    await readFile(grammarPath, 'utf8'),
    grammarPath,
  )
  const dependencies = new Map<string, IRawGrammar>([
    ['text.html.markdown', markdownGrammar],
    ['source.tsx', tsxGrammar],
  ])
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (text) => new OnigString(text),
    }),
    loadGrammar: async (scopeName) =>
      scopeName === 'source.markscript'
        ? markscript
        : (dependencies.get(scopeName) ?? null),
  })
  const loaded = await registry.loadGrammar('source.markscript')
  if (!loaded) throw new Error('MarkScript grammar load failed')
  grammar = loaded
})

describe('MarkScript TextMate grammar', () => {
  test('keeps multiline ESM in TSX and returns to Markdown prose', () => {
    const lines = tokenize([
      'export function Card(props: {title: string}) {',
      '',
      '  return <h2>{props.title}</h2>',
      '}',
      'Plain Markdown after the module.',
    ])

    for (const index of [0, 2, 3]) {
      expect(hasScope(lines[index], 'meta.embedded.esm.markscript')).toBe(true)
    }
    expect(hasScope(lines[0], 'keyword.tsx.stub')).toBe(true)
    expect(hasScope(lines[2], 'keyword.tsx.stub')).toBe(true)
    expect(hasScope(lines[4], 'meta.embedded.esm.markscript')).toBe(false)
    expect(hasScope(lines[4], 'text.markdown.stub')).toBe(true)
  })

  test('distinguishes macros and directives while leaving children as Markdown', () => {
    const lines = tokenize([
      '<Card title={report.title}>',
      '## Markdown *inside* the component',
      '</Card>',
      '::ref{id=summary}',
      '<p>intrinsic</p>',
      '<>',
      'fragment child',
      '</>',
    ])

    expect(hasScope(lines[0], 'meta.tag.component.markscript')).toBe(true)
    expect(hasScope(lines[0], 'entity.name.tag.component.markscript')).toBe(
      true,
    )
    expect(hasScope(lines[1], 'meta.tag.component.markscript')).toBe(false)
    expect(hasScope(lines[1], 'text.markdown.stub')).toBe(true)
    expect(hasScope(lines[2], 'entity.name.tag.component.markscript')).toBe(
      true,
    )
    expect(hasScope(lines[3], 'meta.directive.markscript')).toBe(true)
    expect(
      hasScope(lines[3], 'entity.name.function.directive.markscript'),
    ).toBe(true)
    expect(hasScope(lines[4], 'meta.tag.markscript')).toBe(true)
    expect(hasScope(lines[5], 'meta.tag.fragment.markscript')).toBe(true)
    expect(hasScope(lines[6], 'text.markdown.stub')).toBe(true)
    expect(hasScope(lines[7], 'meta.tag.fragment.markscript')).toBe(true)
    for (const index of [0, 2, 4, 5, 7]) {
      expect(
        hasScope(lines[index], 'punctuation.definition.block.markscript'),
      ).toBe(true)
      expect(
        lines[index]?.some((token) =>
          token.scopes.some(
            (scope) =>
              scope.startsWith('keyword') ||
              scope.startsWith('punctuation.definition.tag'),
          ),
        ),
      ).toBe(false)
    }
  })

  test('balances nested expressions and ignores delimiters consumed by strings', () => {
    const lines = tokenize([
      '{items.map(item => ({label: item.name}))}',
      '{"> and } remain inside this string"}',
      '<Card title="> remains inside this string" />',
      'Markdown after embedded regions.',
    ])

    expect(hasScope(lines[0], 'meta.embedded.expression.markscript')).toBe(true)
    expect(hasScope(lines[1], 'string.quoted.double.tsx.stub')).toBe(true)
    expect(hasScope(lines[2], 'string.quoted.double.tsx.stub')).toBe(true)
    expect(hasScope(lines[3], 'meta.embedded.expression.markscript')).toBe(
      false,
    )
    expect(hasScope(lines[3], 'meta.tag.component.markscript')).toBe(false)
    expect(hasScope(lines[3], 'text.markdown.stub')).toBe(true)
  })

  test('highlights all directive operators and leaves group content as Markdown', () => {
    const lines = tokenize([
      ':run{bold=true}',
      '::paragraph{style=Body}',
      ':::docx{keepNext=true}',
      'Markdown inside the group.',
      ':::',
    ])

    for (const index of [0, 1, 2]) {
      expect(hasScope(lines[index], 'meta.directive.markscript')).toBe(true)
      expect(
        hasScope(lines[index], 'entity.name.function.directive.markscript'),
      ).toBe(true)
    }
    expect(hasScope(lines[3], 'text.markdown.stub')).toBe(true)
  })

  test('lets fenced Markdown own braces that resemble expressions', () => {
    const lines = tokenize(['```md', '{notAnExpression}', '```'])
    expect(hasScope(lines[1], 'markup.raw.fenced.markdown.stub')).toBe(true)
    expect(hasScope(lines[1], 'meta.embedded.expression.markscript')).toBe(
      false,
    )
  })
})

interface TokenView {
  text: string
  scopes: readonly string[]
}

function tokenize(sourceLines: readonly string[]): TokenView[][] {
  let stack = INITIAL
  return sourceLines.map((line) => {
    const result = grammar.tokenizeLine(line, stack)
    stack = result.ruleStack
    return result.tokens.map((token) => ({
      text: line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
    }))
  })
}

function hasScope(
  tokens: readonly TokenView[] | undefined,
  scope: string,
): boolean {
  return tokens?.some((token) => token.scopes.includes(scope)) ?? false
}

const markdownGrammar = parseRawGrammar(
  JSON.stringify({
    scopeName: 'text.html.markdown',
    repository: {},
    patterns: [
      {
        begin: '^```',
        end: '^```$',
        name: 'markup.fenced.markdown.stub',
        contentName: 'markup.raw.fenced.markdown.stub',
      },
      {match: '.+', name: 'text.markdown.stub'},
    ],
  }),
  'markdown-stub.tmLanguage.json',
)

const tsxGrammar = parseRawGrammar(
  JSON.stringify({
    scopeName: 'source.tsx',
    repository: {},
    patterns: [
      {
        match: '"(?:\\\\.|[^"\\\\])*"',
        name: 'string.quoted.double.tsx.stub',
      },
      {
        match: "'(?:\\\\.|[^'\\\\])*'",
        name: 'string.quoted.single.tsx.stub',
      },
      {
        match: '\\b(?:export|function|return|const|let|interface|type)\\b',
        name: 'keyword.tsx.stub',
      },
      {match: '[A-Za-z_$][A-Za-z0-9_$]*', name: 'identifier.tsx.stub'},
      {match: '\\d+(?:\\.\\d+)?', name: 'constant.numeric.tsx.stub'},
    ],
  }),
  'tsx-stub.tmLanguage.json',
)
