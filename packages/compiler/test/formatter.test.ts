import {expect, test} from 'bun:test'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {format} from 'prettier'
import type {MarkscriptNode} from '../src/ast.ts'
import {formatMarkscript} from '../src/formatter.ts'
import {parseMarkscript} from '../src/parser.ts'
import plugin from '../src/prettier.ts'

const cases = [
  '::meta{title="Hello *world*" note="a  b" value={1+2}}',
  ':meta[label **bold**]{#id .one .two title="a &amp; b" title="two" enabled value={{a:1,b:2}} {...rest}}',
  '::::outer[label]{title="a  *b*"}\n\n:::inner{value={n as number}}\nBody :meta{x="**literal**"}\n:::\n\nTail\n::::',
  ':::outer\n:::inner\nBody\n:::',
  '> ::meta{title="a  b"}\n>\n> Paragraph',
  '- :meta{title="a *b*"}\n- ::meta{title="a  b"}',
  '<p title="a  *b*" value={1+2}>hello :meta[x]{title="b  c"} {x as string}</p>',
  '<p><Span run={{bold:true}}>Text<Space /></Span></p>',
  '<Note>\n::meta{title="b  *c*"}\n\nHello\n</Note>',
  '<>\n<h2>Measurements</h2>\n<p>The median was 42 ms.</p>\n</>',
  'Before <>inline <Space /> fragment</> after.',
  '<p>\nRead the{\' \'}\n<a href="./runbook.md">\nrunbook\n</a>\n.\n</p>',
  '| Name | Value |\n| - | - |\n| :meta{x="a  *b*"} | {a?b:c} |',
  '> <Note\n>   title="a  *b*"\n>   value={1+2}\n> >\n> Body\n> </Note>',
  '<p title="a\nb">hi</p>',
  '- <Note value={1+2}>\n  Text\n  </Note>',
  '::meta{{ ...rest }}',
  '::meta{{/* keep */ ...rest}}',
  '<Note {/* keep */ ...rest} />',
  String.raw`::meta{a='quotes " &quot; &amp; &lt;' b="back\\slash" c="<Tag> {literal} _word_"}`,
  '::meta{value={() => {return {x:1}}} {...rest /* keep */}}',
]

test.each(cases)(
  'formats native directive syntax without changing data: %s',
  async (source) => {
    const formatted = await formatMarkscript(source, {printWidth: 40})
    expect(await documentSemantics(formatted)).toEqual(
      await documentSemantics(source),
    )
    expect(await formatMarkscript(formatted, {printWidth: 40})).toBe(formatted)
  },
)

test('the Prettier plugin detects .ms files and matches the shared formatter', async () => {
  const source = '::meta{title="Hello *world*" note="a  b" value={1+2}}'
  const formatted = await format(source, {
    filepath: 'document.ms',
    plugins: [plugin],
  })
  expect(formatted).toBe(
    '::meta{title="Hello *world*" note="a  b" value={1 + 2}}\n',
  )
  expect(formatted).toBe(await formatMarkscript(source))
})

test('formats expression objects and TypeScript without executing source', async () => {
  const source = `export const x=()=>{throw new Error('must not run')}

{({a:1,b:2})}

Text {value as string}.
`
  const formatted = await formatMarkscript(source)
  expect(formatted).toContain("throw new Error('must not run')")
  expect(formatted).toContain('{{ a: 1, b: 2 }}')
  expect(parseMarkscript(formatted, 'document.ms').diagnostics).toEqual([])
})

test('respects Prettier options and preserves syntax when embedded formatting is disabled', async () => {
  const source = '::meta{title="a  *b*" value={1+2}}'
  expect(
    await format(source, {
      parser: 'markscript',
      plugins: [plugin],
      embeddedLanguageFormatting: 'off',
    }),
  ).toBe(`${source}\n`)
  expect(
    await format('export const value=1\n', {
      parser: 'markscript',
      plugins: [plugin],
      semi: true,
    }),
  ).toBe('export const value = 1;\n')
})

test('honors MDX prettier-ignore comments for directives', async () => {
  const source =
    '{/* prettier-ignore */}\n::meta{value={1+2} title="a  *b*"}\n\n::meta{value={1+2}}'
  const formatted = await formatMarkscript(source)
  expect(formatted).toContain('::meta{value={1+2} title="a  *b*"}')
  expect(formatted).toContain('::meta{value={1 + 2}}')
  expect(await formatMarkscript(formatted)).toBe(formatted)
})

const escapedText = [
  String.raw`\[link\](url)`,
  String.raw`\{value\} and \<Tag\> and \:meta`,
  String.raw`\*literal\* and \_text\_ and \~~literal\~~`,
  String.raw`literal \] bracket`,
  String.raw`\!\[image\](url)`,
  'A &amp; B and &lt;Tag&gt; and &#123;value&#125;',
  'back\\\\slash and \\`code\\`',
]

test.each(escapedText)(
  'preserves escaped prose in Markdown and directive contexts: %s',
  async (literal) => {
    for (const source of [
      `Before ${literal} after.`,
      `# Before ${literal} after.`,
      `> Before ${literal} after.`,
      `- Before ${literal} after.`,
      `:meta[Before ${literal} after.]{title="literal"}`,
      `:::meta[Before ${literal} after.]\nBody\n:::`,
      `<p>Before ${literal} after.</p>`,
    ]) {
      const formatted = await formatMarkscript(source)
      expect(await documentSemantics(formatted)).toEqual(
        await documentSemantics(source),
      )
      expect(await formatMarkscript(formatted)).toBe(formatted)
    }
  },
)

test.each([
  ':::box\n\\:::\n\nBody\n:::',
  'Before {"a" // trailing\n} after.',
  '::meta{value={1 // trailing\n}}',
  ':meta[label]{value={1 // trailing\n}}',
  '<Note value={1 // trailing\n} />',
  '::meta{{...rest // trailing\n}}',
  '<Note {...rest // trailing\n} />',
  '{/* leading */ value // trailing\n}',
  '| Value |\n| --- |\n| {()=>{const n=1;return n}} |',
  '| Value |\n| --- |\n| :x{a={{longPropertyName:1,anotherLongProperty:2}}} |',
  '| Value |\n| --- |\n| :x{a="&#124;"} |',
  String.raw`| Value |
| --- |
| {"\u007c"} |`,
  '> {/* first\n> second */}\n>\n> text',
  'Before {`a\nb`} after\n================',
  'Before {`a\nb`} after',
  String.raw`[escaped \[label\]](https://example.test/a "title &amp; words")`,
  String.raw`![a \[b\] &amp; c](img.png "Title")`,
  ':::box\n1. one\n2. two\n\n- a\n- b\n:::',
])('preserves fences and expression comment boundaries: %s', async (source) => {
  const formatted = await formatMarkscript(source)
  expect(await documentSemantics(formatted)).toEqual(
    await documentSemantics(source),
  )
  expect(await formatMarkscript(formatted)).toBe(formatted)
})

test.each([
  '<Space count={4} />',
  '{value + 1}',
  '{ok ? <Span value={1+2} /> : null}',
  '{rows.map((row: Row)=><p>{row.title}</p>)}',
  '{()=>{const a=1;return {longPropertyName:a,anotherProperty:2}}}',
  '<Span value={{longPropertyName:1,anotherProperty:2}}>text</Span>',
  ':mark[label]{value={{longPropertyName:1,anotherProperty:2}}}',
  ':mark[label]{value={1+2}}',
])(
  'keeps custom inline syntax in its Markdown container: %s',
  async (inline) => {
    for (const source of [
      `# Before ${inline} after`,
      `Before ${inline} after\n====================`,
      `**Before ${inline} after**`,
      `*Before ${inline} after*`,
      `~~Before ${inline} after~~`,
      `[Before ${inline} after](https://example.test)`,
      `[Before ${inline} after][ref]\n\n[ref]: https://example.test`,
      `| Value |\n| --- |\n| Before ${inline} after |`,
    ]) {
      const formatted = await formatMarkscript(source)
      expect(await documentSemantics(formatted)).toEqual(
        await documentSemantics(source),
      )
      expect(await formatMarkscript(formatted)).toBe(formatted)
    }
  },
)

test('formats TypeScript expressions containing JSX', async () => {
  const source = '{rows.map((row: Row)=><p>{row.title}</p>)}'
  const formatted = await formatMarkscript(source)
  expect(formatted).toContain('rows.map((row: Row) => <p>{row.title}</p>)')
  expect(await documentSemantics(formatted)).toEqual(
    await documentSemantics(source),
  )
})

test.each(['ms', 'markscript', 'mdx'])(
  'formats %s code fences with the native MarkScript parser',
  async (language) => {
    const code =
      '::meta{title="Hello *world*" value={1+2}}\n\n<Section>\nBody **text**.\n</Section>'
    const source = `\`\`\`${language} example\n${code}\n\`\`\``
    const formatted = await formatMarkscript(source)
    const node = parseMarkscript(formatted, 'document.ms').tree?.children?.[0]
    expect(node?.lang).toBe(language)
    expect(node?.meta).toBe('example')
    expect(node?.value).toContain('value={1 + 2}')
    expect(await documentSemantics(node?.value ?? '')).toEqual(
      await documentSemantics(code),
    )
    expect(await formatMarkscript(formatted)).toBe(formatted)
  },
)

test('keeps nested code fences distinct after formatting their delimiters', async () => {
  const source = '~~~~ms\n~~~text\nliteral\n~~~\n~~~~'
  const formatted = await formatMarkscript(source)
  expect(await documentSemantics(formatted)).toEqual(
    await documentSemantics(source),
  )
  expect(await formatMarkscript(formatted)).toBe(formatted)
})

test('preserves document semantics throughout the example and manual corpus', async () => {
  const root = path.resolve(import.meta.dir, '../../..')
  for (const pattern of [
    'examples/**/*.ms',
    'packages/manuals/manuals/**/*.ms',
  ]) {
    for await (const filename of new Bun.Glob(pattern).scan({cwd: root})) {
      const source = await Bun.file(path.join(root, filename)).text()
      const formatted = await formatMarkscript(source)
      expect(await documentSemantics(formatted), filename).toEqual(
        await documentSemantics(source),
      )
      expect(await formatMarkscript(formatted), filename).toBe(formatted)
    }
  }
}, 30_000)

test('keeps flow directive labels intact when project prose wrapping is enabled', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'markscript-format-label-'),
  )
  const options = {proseWrap: 'always' as const, printWidth: 20}
  try {
    await writeFile(
      path.join(directory, '.prettierrc.json'),
      JSON.stringify(options),
    )
    for (const source of [
      ':::box[A long label with many words and more words]\nA long body with many words to wrap.\n:::',
      '::box[A long label with many words and more words]',
      ':::box[A long **bold label** with <Span data={{longProperty:1,anotherProperty:2}}>words</Span>]\nBody\n:::',
      '> :::box[A long label with many words and more words]\n> Body\n> :::',
    ]) {
      const filename = path.join(directory, 'label.ms')
      const formatted = await formatMarkscript(source, {filename})
      expect(await documentSemantics(formatted)).toEqual(
        await documentSemantics(source),
      )
      expect(await formatMarkscript(formatted, {filename})).toBe(formatted)
      expect(
        await format(source, {
          parser: 'markscript',
          plugins: [plugin],
          ...options,
        }),
      ).toBe(formatted)
    }
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test.each([
  'Before {1 // expression comment\n} after.',
  'Before <Note>inline content</Note> after.',
  'Before {value + 1} after.',
  'Before **text {1 // comment\n} text** after.',
])(
  'retains inline document structure when wrapping prose: %s',
  async (source) => {
    const options = {
      parser: 'markscript',
      plugins: [plugin],
      proseWrap: 'always' as const,
      printWidth: 10,
    }
    const formatted = await format(source, options)
    expect(await documentSemantics(formatted)).toEqual(
      await documentSemantics(source),
    )
    expect(await format(formatted, options)).toBe(formatted)
  },
)

async function expressionSemantics(value: string): Promise<string> {
  return format(`const value = (\n${value}\n)`, {
    parser: 'babel-ts',
    objectWrap: 'collapse',
  })
}

async function documentSemantics(source: string): Promise<unknown> {
  const parsed = parseMarkscript(source, 'document.ms')
  expect(parsed.diagnostics).toEqual([])
  if (!parsed.tree) throw new Error('Expected parsed source')
  async function visit(node: MarkscriptNode): Promise<unknown> {
    const attributes =
      node.directiveAttributes ??
      (Array.isArray(node.attributes) ? node.attributes : undefined)
    let value = node.value
    if (
      value !== undefined &&
      ['mdxTextExpression', 'mdxFlowExpression', 'mdxjsEsm'].includes(node.type)
    ) {
      const parser =
        node.type === 'mdxjsEsm' || !value.trim() || /^\s*\/\*/.test(value)
          ? 'typescript'
          : '__ts_expression'
      value =
        parser === '__ts_expression'
          ? await expressionSemantics(value)
          : await format(value, {parser, objectWrap: 'collapse'})
    } else if (node.type === 'code' && value) {
      if (
        ['ms', 'markscript', 'mdx'].includes(node.lang ?? '') &&
        parseMarkscript(value, 'fence.ms').tree
      ) {
        value = JSON.stringify(await documentSemantics(value))
      } else {
        const parser = codeParsers[node.lang ?? '']
        if (parser) {
          value = await format(value, {parser}).catch(() => value)
        }
      }
    } else if (node.type === 'text') {
      value = value?.replace(/[ \t\r\n]+/g, ' ')
    }
    return {
      ...node,
      position: undefined,
      data: node.data?.directiveLabel ? {directiveLabel: true} : undefined,
      value,
      directiveAttributes: undefined,
      attributes: attributes
        ? await Promise.all(
            attributes.map(async (attribute) => {
              if (attribute.type === 'mdxJsxExpressionAttribute')
                return {
                  type: attribute.type,
                  value: await expressionSemantics(`{${attribute.value}}`),
                }
              return {
                type: attribute.type,
                name: attribute.name,
                value:
                  attribute.value && typeof attribute.value === 'object'
                    ? await expressionSemantics(attribute.value.value)
                    : attribute.value,
              }
            }),
          )
        : undefined,
      children: node.children
        ? await Promise.all(node.children.map(visit))
        : undefined,
    }
  }
  return visit(parsed.tree)
}

const codeParsers: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'babel',
  javascript: 'babel',
  json: 'json',
}
