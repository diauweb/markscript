import {expect, test} from 'bun:test'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {
  check,
  createTypeScriptProjection,
  formatMarkscript,
  parseMarkscript,
  runFile,
} from '../src/index.ts'

const documentation = `/**
 * Render a **greeting** with {@link String} and <angle brackets>.
 *
 * @param name - The recipient.
 * @returns A greeting paragraph.
 */`
const declaration = `export function Greeting({name}: {name: string}) {
  return <p>Hello {name}</p>
}`

test.each(['\n', '\r\n'])(
  'parses leading TSDoc and its export as one module with %j line endings',
  (newline) => {
    for (const prefix of ['', '# Before\n\n']) {
      for (const comment of ['/** A greeting. */', documentation, '/**/']) {
        const module = `${comment}\n${declaration}`.replaceAll('\n', newline)
        const source = `${prefix.replaceAll('\n', newline)}${module}${newline}${newline}# After${newline}`
        const parsed = parseMarkscript(source, 'document.ms')
        expect(parsed.diagnostics).toEqual([])
        const node = parsed.tree?.children?.find(
          (child) => child.type === 'mdxjsEsm',
        )
        expect(node?.value).toBe(module)
        expect(
          source.slice(
            node?.position?.start.offset,
            node?.position?.end.offset,
          ),
        ).toBe(module)
        expect(parsed.tree?.children?.at(-1)?.type).toBe('heading')
      }
    }
  },
)

test('accepts blank lines, adjacent documentation, imports, and multiline exports', () => {
  const source = `/** Module documentation. */

/** Import documentation. */
import type {Root} from 'mdast'

${documentation}

export async function greeting(name: string): Promise<string> {

  return name
}

# After
`
  const parsed = parseMarkscript(source, 'document.ms')
  expect(parsed.diagnostics).toEqual([])
  expect(parsed.tree?.children?.map((node) => node.type)).toEqual([
    'mdxjsEsm',
    'mdxjsEsm',
    'heading',
  ])
  expect(parsed.tree?.children?.[0]?.value).toContain('import type {Root}')
  expect(parsed.tree?.children?.[1]?.value).toContain('return name')
})

test.each([
  '/** Ordinary prose. */\n\n# Heading',
  'Text /** inline prose */\n\n# Heading',
  '/** Unclosed prose',
  '```ts\n/** Fenced documentation. */\nexport const value = 1\n```',
  '> /** Quoted prose. */\n> export const value = 1',
  '    /** Indented prose. */\n    export const value = 1',
  '/** Comment. */\nimportant prose',
  '/** Comment. */\nexported prose',
])('preserves Markdown outside documented module blocks: %s', (source) => {
  const parsed = parseMarkscript(source, 'document.ms')
  expect(parsed.diagnostics).toEqual([])
  expect(parsed.tree?.children?.some((node) => node.type === 'mdxjsEsm')).toBe(
    false,
  )
})

test('preserves documentation through formatting and TypeScript projection', async () => {
  const source = `${documentation}\n${declaration}\n\n<Greeting name="World" />\n`
  const formatted = await formatMarkscript(source)
  expect(formatted).toContain(`${documentation}\nexport function Greeting`)
  expect(await formatMarkscript(formatted)).toBe(formatted)
  const projection = createTypeScriptProjection(source, 'document.ms')
  expect(projection.diagnostics).toEqual([])
  expect(projection.generated?.code).toContain(
    `${documentation}\n${declaration}`,
  )
})

test('reports syntax errors at their original positions after documentation', () => {
  const parsed = parseMarkscript(
    `${documentation}\nexport const broken = ;\n`,
    'document.ms',
  )
  expect(parsed.diagnostics).toMatchObject([
    {code: 'SYN1001', line: 7, column: 23},
  ])
})

test('checks and renders a documented component and maps parameter errors', async () => {
  const directory = await mkdtemp(
    path.join(process.cwd(), '.markscript-documented-esm-test-'),
  )
  const filename = path.join(directory, 'document.ms')
  const source = `${documentation}\n${declaration}\n\n<Greeting name="World" />\n`
  try {
    expect(await check(source, {filename, tsconfig: false})).toEqual([])
    await writeFile(filename, source)
    const root = await runFile(filename, {check: false})
    expect(root.children).toMatchObject([
      {
        type: 'paragraph',
        children: [
          {type: 'text', value: 'Hello '},
          {type: 'text', value: 'World'},
        ],
      },
    ])
    const invalid = source.replace('name="World"', 'name={123}')
    expect(await check(invalid, {filename, tsconfig: false})).toEqual([
      expect.objectContaining({code: 'TS2769', line: 11}),
    ])
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})
