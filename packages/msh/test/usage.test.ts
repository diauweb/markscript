import {expect, test} from 'bun:test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {parseMarkscript} from '@markscript/compiler'
import {defaultContext, promptModule} from '../src/presets.ts'
import {callTool, coreTools} from '../src/protocol.ts'
import type {Completion, ModelRequest, Provider} from '../src/types.ts'
import {createHarness} from './harness.ts'

const guide = await readFile(
  new URL('../prompts/usage.ms', import.meta.url),
  'utf8',
)
const examples = new Map(
  parseMarkscript(guide, 'usage.ms').tree?.children?.flatMap((node) =>
    node.type === 'code' && node.lang === 'markscript' && node.meta
      ? [[node.meta, node.value] as const]
      : [],
  ),
)
function example(name: string): Completion {
  const content = examples.get(`example=${name}`)
  if (!content) throw new Error(`Missing guide example: ${name}`)
  return answer(content)
}
const answer = (content: string): Completion => ({
  message: {role: 'assistant', content},
  finishReason: 'stop',
})
const call = (name: string, args: unknown): Completion => ({
  message: {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: crypto.randomUUID(),
        type: 'function',
        function: {name, arguments: JSON.stringify(args)},
      },
    ],
  },
  finishReason: 'tool_calls',
})
const names = (request: ModelRequest) =>
  request.tools.map((tool) => tool.function.name).sort()
const kernelNames = [...coreTools, callTool].map((tool) => tool.function.name)

test('guide examples distinguish imports, exposure, native input, and retention across exec', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-usage-'))
  await writeFile(path.join(cwd, 'README.md'), 'Guide fixture\nTODO: verify')
  const steps = [
    (request: ModelRequest) => {
      expect(names(request)).toEqual([...kernelNames].sort())
      expect(request.messages[0]?.content).toContain(
        '# msh usage guide for language models',
      )
      return example('import-only')
    },
    (request: ModelRequest) => {
      expect(request.messages.at(-1)?.content).toContain('Guide fixture')
      expect(names(request)).toEqual([...kernelNames].sort())
      return example('expose-library')
    },
    (request: ModelRequest) => {
      expect(names(request)).toEqual([...kernelNames].sort())
      return example('define')
    },
    (request: ModelRequest) => {
      expect(request.messages.at(-1)?.content).toContain('3')
      expect(names(request)).not.toContain('wordCount')
      return call('call', {
        name: 'wordCount',
        arguments: {text: 'one two three', minimumLength: 4},
      })
    },
    (request: ModelRequest) => {
      expect(request.messages.at(-1)?.content).toBe('1')
      return example('retain')
    },
    (request: ModelRequest) => {
      expect(names(request)).toEqual([...kernelNames, 'wordCount'].sort())
      expect(request.messages[0]?.content).toContain(
        '# msh usage guide for language models',
      )
      expect(request.messages.at(-1)?.content).toContain('red green blue')
      return call('wordCount', {text: 'red green blue'})
    },
    (request: ModelRequest) => {
      expect(request.messages.at(-1)?.content).toBe('3')
      return answer('Verified three words.')
    },
  ]
  const provider: Provider = {
    async complete(request) {
      const step = steps.shift()
      if (!step) throw new Error('Unexpected continuation')
      return step(request)
    },
  }
  const host = await createHarness({
    cwd,
    context: {instructions: [promptModule('worker')], messages: []},
    provider,
  })
  try {
    const exposed = await host.turn('Read and expose workspace functions.')
    expect(exposed.error).toBeUndefined()
    expect(exposed.state).toBe('idle')
    const result = await host.turn('Define, use, and retain wordCount.')
    expect(result.error).toBeUndefined()
    expect(result.generation).toBe(1)
    expect(result.messages.at(-1)?.content).toBe('Verified three words.')
    expect(steps).toHaveLength(0)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)

test('workspace guide examples render async evidence and explicitly equip a child', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-usage-'))
  await writeFile(path.join(cwd, 'README.md'), 'Guide fixture\nTODO: verify')
  let root = ''
  let childRequests = 0
  const steps = [
    (request: ModelRequest) => {
      expect(names(request)).toEqual(
        [
          ...kernelNames,
          'read',
          'list',
          'search',
          'write',
          'replace',
          'command',
        ].sort(),
      )
      return example('read')
    },
    (request: ModelRequest) => {
      expect(request.messages.at(-1)?.content).toContain('Guide fixture')
      return example('command')
    },
    (request: ModelRequest) => {
      expect(request.messages.at(-1)?.content).toContain(cwd)
      return example('sequence')
    },
    (request: ModelRequest) => {
      expect(request.messages.at(-1)?.content).toContain('TODO: verify')
      return example('spawn-worker')
    },
    () => answer('Child started.'),
  ]
  const provider: Provider = {
    async complete(request) {
      if (
        !request.messages[0]?.content?.includes(`Current thread: ${root}\n`)
      ) {
        childRequests++
        expect(names(request)).toEqual(
          [...kernelNames, 'read', 'search'].sort(),
        )
        expect(request.messages[0]?.content).toContain(
          '# msh usage guide for language models',
        )
        return answer('Worker received instructions and selected tools.')
      }
      const step = steps.shift()
      if (!step) throw new Error('Unexpected continuation')
      return step(request)
    },
  }
  const host = await createHarness({cwd, context: defaultContext(), provider})
  root = host.root
  try {
    const result = await host.turn('Exercise the workspace examples.')
    expect(result.error).toBeUndefined()
    expect(result.children).toHaveLength(1)
    const child = result.children[0]
    if (!child) throw new Error('Missing worker')
    await host.wait(child)
    expect(host.inspect(child).error).toBeUndefined()
    expect(host.inspect(child).state).toBe('idle')
    expect(childRequests).toBe(1)
    expect(steps).toHaveLength(0)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)
