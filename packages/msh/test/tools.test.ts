import {expect, test} from 'bun:test'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {analyzeFile} from '@markscript/compiler'
import {inferTools} from '../src/tools.ts'

test('export schemas resolve imported types statically, validate nested input and apply defaults', async () => {
  const dir = await mkdtemp('/tmp/msh-types-')
  try {
    await writeFile(
      path.join(dir, 'input.ts'),
      'export interface Input {items: {id: number; label?: string}[]; mode: "a" | "b"}\n',
    )
    const filename = path.join(dir, 'tools.ms')
    await writeFile(
      filename,
      'import type {Input} from "./input.ts"\n\nexport const evaluated = (() => {throw new Error("module evaluated")})()\n\nexport function choose(input: Input) { throw new Error("must not execute") }\n\nexport function scale(value: number, factor = 2) {return value * factor}\n\n# Static\n',
    )
    const analysis = await analyzeFile(filename)
    expect(analysis.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    )
    const tools = await inferTools(filename)
    expect(tools.map((tool) => tool.definition.function.name)).toEqual([
      'choose',
      'scale',
    ])
    expect(tools[0]?.arguments({items: [{id: 1}], mode: 'a'})).toEqual([
      {items: [{id: 1}], mode: 'a'},
    ])
    expect(() =>
      tools[0]?.arguments({items: [{id: 'wrong'}], mode: 'a'}),
    ).toThrow()
    expect(() =>
      tools[0]?.arguments({items: [], mode: 'a', surplus: true}),
    ).toThrow()
    expect(tools[1]?.arguments({value: 3})).toEqual([3, undefined])
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('unsupported argument types fail before module execution', async () => {
  const dir = await mkdtemp('/tmp/msh-types-')
  try {
    const filename = path.join(dir, 'invalid.ms')
    await writeFile(
      filename,
      'export function unsafe(input: unknown) {return input}\n\n# Invalid\n',
    )
    await expect(inferTools(filename)).rejects.toThrow(
      `${filename}:1:1: tool unsafe: Unsupported tool parameter type: unknown`,
    )
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})
