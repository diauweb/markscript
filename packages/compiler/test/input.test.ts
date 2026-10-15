import {afterAll, beforeAll, expect, test} from 'bun:test'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import type {Root} from 'mdast'
import {toMarkdown} from 'mdast-util-to-markdown'
import {bundleFile, check, compile, runFile} from '../src/index.ts'

let directory: string
beforeAll(async () => {
  directory = await mkdtemp(path.join(process.cwd(), '.markscript-input-'))
})
afterAll(async () => {
  await rm(directory, {recursive: true, force: true})
})

const source = `import {onReady, onTransform} from '@markscript/runtime'

export interface Input {
  title: string
  ready?: (title: string) => void
}

export function formatTitle(data: Input) {
  return data.title.toUpperCase()
}

# {formatTitle(input)}

{onTransform(async ({root}) => {
  await Promise.resolve()
  root.data = {title: input.title}
})}

{onReady(async () => {
  await Promise.resolve()
  input.ready?.(input.title)
})}
`

test('compiled and bundled entries isolate input and lifetime callbacks across calls', async () => {
  const filename = path.join(directory, 'report.ms')
  await writeFile(filename, source)
  for (const [name, result] of [
    ['compiled', await compile(source, {filename, tsconfig: false})],
    ['bundled', await bundleFile(filename, {tsconfig: false})],
  ] as const) {
    expect(
      result.diagnostics.filter((item) => item.severity === 'error'),
    ).toEqual([])
    const output = path.join(directory, `${name}.mjs`)
    await writeFile(output, result.code)
    const module = (await import(pathToFileURL(output).href)) as {
      default: (input: {
        title: string
        ready: (title: string) => void
      }) => Promise<Root>
      formatTitle: (input: {title: string}) => string
    }
    const ready: string[] = []
    const roots = await Promise.all(
      ['first', 'second'].map((title) =>
        module.default({
          title,
          ready: (value) => {
            ready.push(value)
          },
        }),
      ),
    )
    expect(roots.map((root) => toMarkdown(root))).toEqual([
      '# FIRST\n',
      '# SECOND\n',
    ])
    expect(roots.map((root) => root.data)).toEqual([
      {title: 'first'},
      {title: 'second'},
    ])
    expect(ready.sort()).toEqual(['first', 'second'])
    expect(module.formatTitle({title: 'helper'})).toBe('HELPER')
  }
  expect(
    toMarkdown(
      await runFile(filename, {input: {title: 'loader'}, tsconfig: false}),
    ),
  ).toBe('# LOADER\n')
})

test('imported document signatures check required input and preserve parameterless entries', async () => {
  await writeFile(
    path.join(directory, 'typed.ms'),
    'export type Input = {title: string}\n\n# {input.title}\n',
  )
  await writeFile(path.join(directory, 'plain.ms'), '# Plain\n')
  const good = `import typed from './typed.ms'
import plain from './plain.ms'

{typed({title: 'Nested'})}

{plain()}
`
  const filename = path.join(directory, 'parent.ms')
  expect(
    (await check(good, {filename, tsconfig: false})).filter(
      (item) => item.severity === 'error',
    ),
  ).toEqual([])
  await writeFile(filename, good)
  expect(toMarkdown(await runFile(filename, {tsconfig: false}))).toBe(
    '# Nested\n\n# Plain\n',
  )
  const bad = good
    .replace("typed({title: 'Nested'})", 'typed()')
    .replace('plain()', 'plain({})')
  const errors = (await check(bad, {filename, tsconfig: false})).filter(
    (item) => item.severity === 'error',
  )
  expect(errors).toHaveLength(2)
  expect(errors.map((item) => item.line)).toEqual([4, 6])
  const wrong = await check(good.replace("title: 'Nested'", 'title: 42'), {
    filename,
    tsconfig: false,
  })
  expect(
    wrong.some((item) => item.severity === 'error' && item.line === 4),
  ).toBe(true)
})

test('input is scoped to document expressions and its properties are checked', async () => {
  const filename = path.join(directory, 'scope.ms')
  const diagnostics = await check(
    `export interface Input {title: string}

export function invalid() { return input.title }

# {input.missing}
`,
    {filename, tsconfig: false},
  )
  const errors = diagnostics.filter((item) => item.severity === 'error')
  expect(errors).toHaveLength(2)
  expect(errors.map((item) => item.line)).toEqual([3, 5])
  expect(errors[0]?.message).toContain("Cannot find name 'input'")
  expect(errors[1]?.message).toContain("Property 'missing'")
})
