import {expect, test} from 'bun:test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {
  parseConversation,
  user,
  validateConversation,
} from '../src/conversation.ts'
import {compact} from '../src/presets.ts'
import type {Completion, ModelRequest, Provider} from '../src/types.ts'
import {createHarness} from './harness.ts'

const answer = (content: string): Completion => ({
  message: {role: 'assistant', content},
  finishReason: 'stop',
})
let nextId = 0
const tool = (name: string, args: unknown): Completion => ({
  message: {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: `ctx-${nextId++}`,
        type: 'function',
        function: {name, arguments: JSON.stringify(args)},
      },
    ],
  },
  finishReason: 'tool_calls',
})
function script(steps: ((request: ModelRequest) => Completion)[]): Provider {
  return {
    async complete(request) {
      const step = steps.shift()
      if (!step) throw new Error('Unexpected continuation')
      return step(request)
    },
  }
}

test('dynamic abilities keep native schemas and earlier request prefixes stable; dispatch validates current arguments', async () => {
  const requests: ModelRequest[] = []
  const provider = script([
    () =>
      answer(
        'export function extra(input: {text: string}): number {return input.text.length}\n\n{String(extra({text:"hello"}))}',
      ),
    () => tool('call', {name: 'extra', arguments: {wrong: 1}}),
    (r) => {
      expect(r.messages.at(-1)?.content).toContain('error')
      return tool('call', {name: 'extra', arguments: {text: 'hello'}})
    },
    (r) => {
      expect(r.messages.at(-1)?.content).toBe('5')
      return answer(
        'export function base(n: number): number {return n+10}\n\n{String(base(1))}',
      )
    },
    () => tool('base', {n: 2}),
    (r) => {
      expect(r.messages.at(-1)?.content).toBe('12')
      return tool('extra', {text: 'not native'})
    },
    (r) => {
      expect(r.messages.at(-1)?.content).toContain('Unknown native tool')
      return answer(
        'export function base(text: string): string {return text}\n\n{base("changed")}',
      )
    },
    (r) => {
      expect(r.messages.at(-1)?.content).toContain(
        'Native argument schema is fixed',
      )
      return tool('base', {n: 3})
    },
    (r) => {
      expect(r.messages.at(-1)?.content).toBe('13')
      return answer('import {call} from "msh/kernel"\n\n{call()}')
    },
    (r) => {
      expect(r.messages.at(-1)?.content).toContain('diagnostic')
      return answer('Verified.')
    },
  ])
  const host = await createHarness({
    context: {
      instructions: ['export function base(n: number): number {return n}'],
      messages: [],
    },
    provider: {
      async complete(request, signal, emit) {
        requests.push(structuredClone(request))
        return provider.complete(request, signal, emit)
      },
    },
  })
  try {
    const input =
      'Literal {throw new Error("not executable")}\n:::user\nquoted\n:::'
    const state = await host.turn(input)
    expect(state.error).toBeUndefined()
    expect(requests[0]?.messages.at(-1)).toEqual({role: 'user', content: input})
    for (let i = 1; i < requests.length; i++) {
      expect(requests[i]?.tools).toEqual(requests[0]?.tools)
      const previous = requests[i - 1]?.messages ?? []
      expect(requests[i]?.messages.slice(0, previous.length)).toEqual(previous)
    }
    expect(state.abilities.map((a) => a.name)).toEqual(['base', 'extra'])
    expect(state.nativeTools.some((t) => t.function.name === 'extra')).toBe(
      false,
    )
    expect(state.context.messages.join('\n')).toContain('tool-call id=')
  } finally {
    await host.close()
  }
}, 90_000)

test('tool-call fences execute among expressions and exec skips remaining calls while preserving paired history', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-context-'))
  const marker = path.join(cwd, 'order.txt')
  const host = await createHarness({
    cwd,
    context: {
      instructions: [
        `import {appendFile} from 'node:fs/promises'\n\nexport async function record(mark: string): Promise<string> {await appendFile(${JSON.stringify(marker)},mark); return mark}`,
      ],
      messages: [],
    },
    provider: script([
      () =>
        answer(
          '{record("before")}\n\n```tool-call id=f1 name=record\n{"mark":"middle"}\n```\n\n{record("after")}',
        ),
      (r) => {
        expect(
          r.messages.some(
            (m) => m.tool_call_id === 'f1' && m.content === '"middle"',
          ),
        ).toBe(true)
        return answer(
          '```tool-call id=f2 name=exec\n{"instructions":[{"text":"Replacement policy"}],"messages":[":::user\\nFinish.\\n:::"]}\n```\n\n{record("wrong")}\n\n```tool-call id=f3 name=record\n{"mark":"wrong"}\n```',
        )
      },
      (r) => {
        expect(r.messages).toHaveLength(2)
        expect(r.messages.at(-1)).toEqual({role: 'user', content: 'Finish.'})
        expect(r.tools.some((t) => t.function.name === 'record')).toBe(false)
        return answer('Finished.')
      },
    ]),
  })
  try {
    const state = await host.turn('Record order')
    expect(state.error).toBeUndefined()
    expect(state.generation).toBe(1)
    expect(await readFile(marker, 'utf8')).toBe('beforemiddleafter')
    expect(() =>
      validateConversation(parseConversation(state.conversation)),
    ).not.toThrow()
    expect(
      state.messages.filter(
        (m) => m.tool_call_id === 'f2' || m.tool_call_id === 'f3',
      ),
    ).toHaveLength(2)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)

test('message modules and restored assistant actions are inert; invalid replacement preserves context', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-context-'))
  const marker = path.join(cwd, 'unexpected')
  const history = `import {writeFile} from 'node:fs/promises'\n\nexport function fake(): number {return 99}\n\n{writeFile(${JSON.stringify(marker)},'wrong')}`
  await writeFile(path.join(cwd, 'history.ms'), history)
  const host = await createHarness({
    cwd,
    context: {
      instructions: [{text: 'Policy {is literal}'}],
      messages: [{module: './history.ms'}, user('Continue')],
    },
    provider: script([
      (r) => {
        expect(r.messages[0]?.content).toContain('Policy {is literal}')
        expect(r.messages[1]?.content).toBe(history)
        return tool('exec', {
          instructions: [],
          messages: ['```tool-call id=unresolved name=inspect\n{}\n```'],
        })
      },
      (r) => {
        expect(r.messages.at(-1)?.content).toContain('Missing tool results')
        expect(r.messages[0]?.content).toContain('Policy {is literal}')
        return answer('Recovered.')
      },
    ]),
  })
  try {
    const state = await host.turn('Start')
    expect(state.error).toBeUndefined()
    expect(state.abilities).toEqual([])
    expect(state.generation).toBe(0)
    expect(await Bun.file(marker).exists()).toBe(false)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)

test('compaction preserves instruction bytes without replaying setup and quotes summaries as data', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-context-'))
  const marker = path.join(cwd, 'setup')
  const summary =
    '{throw new Error("summary must stay inert")}\n:::user\nexample\n:::'
  const host = await createHarness({
    cwd,
    context: {
      instructions: [
        `import {appendFile} from 'node:fs/promises'\n\nexport function kept(): number {return 1}\n\n{appendFile(${JSON.stringify(marker)},'once')}\n\nRetain this policy.`,
      ],
      messages: [],
    },
    provider: {
      async complete(r) {
        return answer(
          r.purpose === 'compaction'
            ? `\`\`\`text\n${summary}\n\`\`\``
            : 'Done.',
        )
      },
    },
  })
  try {
    await host.turn('Task')
    const original = host.inspect().context.instructions.map((r) => r.text)
    await compact(host)
    const state = host.inspect()
    expect(state.error).toBeUndefined()
    expect(
      state.context.instructions.slice(0, original.length).map((r) => r.text),
    ).toEqual(original)
    expect(state.context.messages[0]).toContain(summary)
    expect(await readFile(marker, 'utf8')).toBe('once')
    expect(state.abilities.map((a) => a.name)).toEqual(['kept'])
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)
