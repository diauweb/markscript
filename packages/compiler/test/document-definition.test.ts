import {afterAll, beforeAll, expect, test} from 'bun:test'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {documentDefinition} from '@markscript/runtime'
import {
  check,
  compile,
  installBunLoader,
  registerModuleSource,
} from '../src/index.ts'

let directory: string
beforeAll(async () => {
  directory = await mkdtemp(path.join(process.cwd(), '.markscript-definition-'))
  installBunLoader()
})
afterAll(async () => {
  await rm(directory, {recursive: true, force: true})
})
test('callable definitions preserve aliased exports and origin without executing render during import', async () => {
  await writeFile(
    path.join(directory, 'dependency.ts'),
    'export function plus(n: number) {return n+1}\nexport const label = "label"',
  )
  const filename = path.join(directory, 'document.ms')
  const source =
    "export {plus as add} from './dependency.ts'\n\nexport * from './dependency.ts'\n\nexport const fixed = 3\n\n{(() => {throw new Error('render only')})()}"
  registerModuleSource(filename, source)
  const checked = await compile(source, {
    filename,
    sourceOverrides: new Map([[filename, source]]),
  })
  expect(checked.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  const module = await import(pathToFileURL(filename).href)
  const definition = documentDefinition(module.default)
  expect(definition?.origin).toBe(filename)
  expect(definition?.bindings().add).toBe(module.add)
  expect(definition?.bindings().fixed).toBe(3)
  await expect(module.default()).rejects.toThrow('render only')
}, 30_000)
test('type-only exports remain erased and static processing does not evaluate code', async () => {
  const filename = path.join(directory, 'types.ms')
  const source =
    'export interface Options {title: string}\n\nexport type Label = string\n\nexport const sideEffect = (() => {throw new Error("evaluated")})()\n\n# Static'
  expect(
    (await check(source, {filename})).filter((d) => d.severity === 'error'),
  ).toEqual([])
  expect((await compile(source, {filename})).code).not.toContain('"Options":')
}, 30_000)
