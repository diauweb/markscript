import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {existsSync} from 'node:fs'
import {access, mkdir, readFile, rm, unlink, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {runFile} from '@markscript/compiler'
import {main} from '../src/cli.ts'

const temporaryRoot = path.join(process.cwd(), '.markscript-cli-test')

beforeAll(async () => {
  await mkdir(temporaryRoot, {recursive: true})
})

afterAll(async () => {
  await rm(temporaryRoot, {recursive: true, force: true})
})

describe('citty CLI', () => {
  test('run explains a catalogued failure before executing the document', async () => {
    const source = path.join(temporaryRoot, 'invalid.ms')
    const sideEffect = path.join(temporaryRoot, 'must-not-exist')
    await writeFile(
      source,
      [
        `import {writeFileSync} from 'node:fs'`,
        '',
        `<article>{writeFileSync(${JSON.stringify(sideEffect)}, 'ran')}</article>`,
        '',
      ].join('\n'),
    )

    const messages: string[] = []
    const originalError = console.error
    console.error = (...values: unknown[]) => {
      messages.push(values.map(String).join(' '))
    }
    try {
      expect(await main(['run', source])).toBe(1)
    } finally {
      console.error = originalError
    }

    expect(await fileExists(sideEffect)).toBe(false)
    expect(messages.join('\n')).toContain('Help: markscript help ERR1101')
    expect(messages.join('\n')).toContain('/ERR1101.ms')
  })

  test('bundles callable ESM while preserving its source', async () => {
    const source = path.join(temporaryRoot, 'compile.ms')
    const output = path.join(temporaryRoot, 'compile.mjs')
    const input = '# Compiled\n'
    await writeFile(source, input)

    expect(
      await main(['compile', source, '-o', output, '--transpile-only']),
    ).toBe(0)
    const compiled = (await import(
      `${pathToFileURL(output).href}?cli-test=compile`
    )) as {default?: () => Promise<unknown>}
    expect(typeof compiled.default).toBe('function')
    expect(await compiled.default?.()).toMatchObject({
      type: 'root',
      children: [{type: 'heading', depth: 1}],
    })

    expect(
      await main(['compile', source, '-o', source, '--transpile-only']),
    ).toBe(2)
    expect(await readFile(source, 'utf8')).toBe(input)
  })

  test('formats and checks source without executing the document', async () => {
    const source = path.join(temporaryRoot, 'format.ms')
    await writeFile(
      source,
      "export const sideEffect=(()=>{throw new Error('executed')})()\n\n# {sideEffect?'yes':'no'}\n",
    )

    expect(await main(['format', source, '--check'])).toBe(1)
    expect(await main(['format', source, '--write'])).toBe(0)
    const formatted = await readFile(source, 'utf8')
    expect(formatted).toContain(
      "export const sideEffect = (() => {\n  throw new Error('executed')",
    )
    expect(formatted).toContain("# {sideEffect ? 'yes' : 'no'}")
    expect(await main(['format', source, '--check'])).toBe(0)
  })

  test('CLI run and an imported default entry complete to equivalent MDAST', async () => {
    const source = path.join(temporaryRoot, 'equivalent.ms')
    const observed = path.join(temporaryRoot, 'equivalent.json')
    await writeFile(
      source,
      `import {onReady} from '@markscript/markscript'
import {writeFile} from 'node:fs/promises'

# Equivalent

{onReady(({root}) => writeFile(${JSON.stringify(observed)}, JSON.stringify(root)))}
`,
    )

    const importedRoot = await runFile(source)
    const importedObservation = JSON.parse(await readFile(observed, 'utf8'))
    expect(importedObservation).toEqual(importedRoot)

    await unlink(observed)
    let emitted = ''
    let lifecycleFinishedBeforeOutput = false
    const originalLog = console.log
    console.log = (...values: unknown[]) => {
      lifecycleFinishedBeforeOutput = existsSync(observed)
      emitted = values.map(String).join(' ')
    }
    try {
      expect(await main(['run', source])).toBe(0)
    } finally {
      console.log = originalLog
    }
    const cliObservation = JSON.parse(await readFile(observed, 'utf8'))
    expect(cliObservation).toEqual(importedRoot)
    expect(lifecycleFinishedBeforeOutput).toBe(true)
    expect(emitted).toBe('# Equivalent')
  })
})

async function fileExists(filename: string): Promise<boolean> {
  try {
    await access(filename)
    return true
  } catch {
    return false
  }
}
