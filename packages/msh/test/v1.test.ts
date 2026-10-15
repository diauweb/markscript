import {afterAll, beforeAll, expect, test} from 'bun:test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {installBunLoader} from '@markscript/compiler'
import {documentDefinition} from '@markscript/runtime'
import {HistoryWriter, readHistory} from '../src/journal.ts'
import {inspect, spawn, wait} from '../src/kernel.ts'
import {compact, defaultContext} from '../src/presets.ts'
import type {Completion, ModelRequest, Provider} from '../src/types.ts'
import {command} from '../src/workspace.ts'
import {createHarness} from './harness.ts'

let cwd: string
beforeAll(async () => {
  cwd = await mkdtemp(path.join(process.cwd(), '.markscript-v1-'))
  installBunLoader()
})
afterAll(async () => {
  await rm(cwd, {recursive: true, force: true})
})
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
function script(
  steps: ((r: ModelRequest) => Completion | Promise<Completion>)[],
): Provider {
  let index = 0
  return {
    async complete(r, signal, emit) {
      signal.throwIfAborted()
      const fn = steps[index++]
      if (!fn) throw new Error('Unexpected model continuation')
      const result = await fn(r)
      if (result.message.content) emit(result.message.content)
      return result
    },
  }
}
const done: Provider = {
  async complete() {
    return answer('Done.')
  },
}
const timeout = 60_000

test(
  'emitted typed abilities, native calls, redefinition, and inert code fences',
  async () => {
    const host = await createHarness({
      cwd,
      provider: script([
        () =>
          answer(
            'export function twice(n: number): number {return n*2}\n\n{String(twice(2))}',
          ),
        (r) => {
          expect(r.tools.some((t) => t.function.name === 'twice')).toBe(false)
          return call('call', {name: 'twice', arguments: {n: 21}})
        },
        (r) => {
          expect(r.messages.at(-1)?.content).toBe('42')
          return answer(
            'export function twice(n: number): number {return n*3}\n\n{String(twice(2))}',
          )
        },
        () => call('call', {name: 'twice', arguments: {n: 7}}),
        (r) => {
          expect(r.messages.at(-1)?.content).toBe('21')
          return answer('```ts\nthrow new Error("inert")\n```')
        },
      ]),
    })
    try {
      const state = await host.turn('Calculate')
      expect(state.error).toBeUndefined()
      expect(state.state).toBe('idle')
      expect(state.abilities.map((a) => a.name)).toEqual(['twice'])
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'exec replaces provider context and abilities, preserves identity/history/children, and skips old actions',
  async () => {
    const marker = path.join(cwd, 'must-not-exist')
    const host = await createHarness({
      cwd,
      context: {
        instructions: [
          'export function old(): string {return "old"}\n\nOld instructions SECRET_CONTEXT',
        ],
        messages: [],
      },
      provider: script([
        () =>
          answer(
            `import {writeFile} from 'node:fs/promises'\n\n{exec({instructions: ['# New context'], messages: []})}\n\n{writeFile(${JSON.stringify(marker)},'wrong')}`,
          ),
        (r) => {
          expect(JSON.stringify(r.messages)).not.toContain('SECRET_CONTEXT')
          expect(r.tools.some((t) => t.function.name === 'old')).toBe(false)
          return answer('Replaced.')
        },
      ]),
    })
    try {
      const child = await host.spawn({
        default: async () => {
          await wait()
        },
      })
      const original = host.root
      const state = await host.turn('Replace now')
      expect(state.error).toBeUndefined()
      expect(state.id).toBe(original)
      expect(state.generation).toBe(1)
      const committed = host.events
        .filter((event) => event.type === 'context')
        .at(-1)
      expect(committed?.data).toMatchObject({generation: 1})
      expect(state.children).toContain(child)
      expect(host.inspect(child).state).toBe('waiting')
      expect(state.messages.some((m) => m.content === 'Replace now')).toBe(true)
      expect(await Bun.file(marker).exists()).toBe(false)
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'failed exec leaves old ability active and native tool results remain paired',
  async () => {
    const host = await createHarness({
      cwd,
      context: {
        instructions: ['export function keep(): number {return 7}'],
        messages: [],
      },
      provider: script([
        () =>
          call('exec', {
            instructions: [{module: './missing.ms'}],
            messages: [],
          }),
        (r) => {
          expect(r.messages.at(-1)?.role).toBe('tool')
          expect(r.tools.some((t) => t.function.name === 'keep')).toBe(true)
          return call('keep', {})
        },
        (r) => {
          expect(r.messages.at(-1)?.content).toBe('7')
          return answer('Recovered.')
        },
      ]),
    })
    try {
      expect((await host.turn('Replace')).generation).toBe(0)
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'reexporting previous emitted definitions retains tools without replaying document actions',
  async () => {
    const marker = path.join(cwd, 'effects.txt')
    const host = await createHarness({
      cwd,
      provider: script([
        () =>
          answer(
            `import {appendFile} from 'node:fs/promises'\n\nexport function kept(n: number): number {return n+1}\n\n{appendFile(${JSON.stringify(marker)},'once')}`,
          ),
        () => answer('Ready.'),
        () => call('kept', {n: 8}),
        (r) => {
          expect(r.messages.at(-1)?.content).toBe('9')
          return answer('Retained.')
        },
      ]),
    })
    try {
      await host.turn('Define')
      const origin = host.inspect().abilities[0]?.module
      expect(origin).toBeDefined()
      await host.replaceIdle(host.root, {
        instructions: [
          `export {kept} from ${JSON.stringify(origin)}\n\nNew instructions.`,
        ],
        messages: [],
      })
      expect(host.inspect().error).toBeUndefined()
      expect(await readFile(marker, 'utf8')).toBe('once')
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'imported documents carry exports/origin and JS module references share primitive resolution',
  async () => {
    await writeFile(path.join(cwd, 'relative.ts'), 'export const value = 9')
    await writeFile(
      path.join(cwd, 'reviewer.ms'),
      "import {value} from './relative.ts'\n\nexport function number(): number {return value}\n\n# Reviewer {value}",
    )
    await writeFile(
      path.join(cwd, 'code.ts'),
      "import {inspect} from 'msh/kernel'\nexport default async function () {return inspect().kind}",
    )
    const Reviewer = (
      await import(pathToFileURL(path.join(cwd, 'reviewer.ms')).href)
    ).default
    expect(documentDefinition(Reviewer)?.origin).toBe(
      path.join(cwd, 'reviewer.ms'),
    )
    expect((await Reviewer()).type).toBe('root')
    const host = await createHarness({cwd, provider: done})
    try {
      const child = await host.spawn({
        instructions: [Reviewer],
        messages: [':::user\nTask\n:::'],
      })
      await host.wait(child)
      expect(host.inspect(child).abilities.map((a) => a.name)).toEqual([
        'number',
      ])
      const code = await host.spawn({module: './code.ts'})
      await host.wait(code)
      expect(host.inspect(code).result).toBe('code')
      expect(host.inspect(code).state).toBe('dead')
      await host.send(child, 'Follow up')
      await host.wait(child)
      expect(host.inspect(child).state).toBe('idle')
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'inbox wait consumes queued messages without lost wakeups; inspect never consumes',
  async () => {
    const host = await createHarness({cwd, provider: done})
    let first: unknown
    let second: unknown
    try {
      const child = await host.spawn({
        default: async () => {
          first = await wait()
          second = await wait()
          return inspect('self')
        },
      })
      await host.send(child, 'First')
      expect(host.inspect(child).pending).toBe(1)
      await host.send(child, 'Second')
      // Both pending messages are returned by the first inbox wait.
      await new Promise((resolve) => setTimeout(resolve, 30))
      await host.send(child, 'Third')
      await host.wait(child)
      expect(first).toMatchObject({
        reason: 'message',
        messages: [{text: 'First'}, {text: 'Second'}],
      })
      expect(second).toMatchObject({
        reason: 'message',
        messages: [{text: 'Third'}],
      })
      expect(host.inspect(child).pending).toBe(0)
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'wait(child) preserves ordinary inbox messages, broadcast excludes sender and siblings, death cancels children',
  async () => {
    const host = await createHarness({cwd, provider: done})
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let leaf = ''
    let readPending = -1
    try {
      const parent = await host.spawn({
        default: async () => {
          leaf = await spawn({default: async () => blocked})
          await wait(leaf)
          readPending = inspect().pending
          await wait()
        },
      })
      while (!leaf) await new Promise((r) => setTimeout(r, 1))
      const sibling = await host.spawn({
        default: async () => {
          await wait()
        },
      })
      await host.send(parent, 'Queued')
      expect(host.inspect(parent).state).toBe('waiting')
      await host.send('descendants', 'Broadcast', parent)
      expect(host.inspect(leaf).pending).toBe(1)
      expect(host.inspect(parent).pending).toBe(1)
      expect(host.inspect(sibling).pending).toBe(0)
      release()
      await host.wait(parent)
      expect(readPending).toBe(1)
      expect(host.inspect(leaf).state).toBe('dead')
      await host.send(host.root, {control: 'terminate'})
      await host.wait(host.root)
      expect(host.inspect(sibling).state).toBe('dead')
    } finally {
      release()
      await host.close()
    }
  },
  timeout,
)

test(
  'interrupt cancels a provider turn, retains the thread and children, and allows a later turn',
  async () => {
    let started!: () => void
    const active = new Promise<void>((r) => {
      started = r
    })
    let first = true
    const provider: Provider = {
      async complete(_r, signal) {
        if (!first) return answer('Next turn.')
        first = false
        started()
        await new Promise((_r, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        )
        return answer('Impossible')
      },
    }
    const host = await createHarness({cwd, provider})
    try {
      let childWaiting!: () => void
      const ready = new Promise<void>((resolve) => {
        childWaiting = resolve
      })
      const child = await host.spawn({
        default: async () => {
          const inbox = wait()
          childWaiting()
          await inbox
        },
      })
      await ready
      await host.send(host.root, 'Start')
      await active
      await host.send(host.root, {control: 'interrupt'})
      await host.wait(host.root)
      expect(host.inspect().state).toBe('idle')
      expect(host.inspect(child).state).toBe('waiting')
      expect((await host.turn('Again')).messages.at(-1)?.content).toBe(
        'Next turn.',
      )
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'workspace commands use cwd and abort their process group',
  async () => {
    const host = await createHarness({cwd})
    try {
      const child = await host.spawn({
        default: async () => command('printf started; sleep 30', 60),
      })
      await new Promise((r) => setTimeout(r, 100))
      const start = Date.now()
      await host.send(child, {control: 'interrupt'})
      await host.wait(child)
      expect(Date.now() - start).toBeLessThan(3000)
      expect(host.inspect(child).state).toBe('dead')
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'compaction keeps retained bindings and inert history exports, then continues the same thread',
  async () => {
    const provider: Provider = {
      async complete(r) {
        if (r.messages[0]?.content?.includes('# Context summarizer'))
          return answer('Task: finish arithmetic. Previously calculated 2.')
        return answer('Ready.')
      },
    }
    const host = await createHarness({
      cwd,
      provider,
      context: {
        instructions: ['export function count(): number {return 2}'],
        messages: [],
      },
    })
    const filename = path.join(cwd, 'history.jsonl')
    const journal = new HistoryWriter(filename, host)
    try {
      await host.turn('Keep task')
      await compact(host)
      const state = host.inspect()
      expect(state.error).toBeUndefined()
      expect(state.generation).toBe(1)
      expect(state.abilities.map((a) => a.name)).toEqual(['count'])
      await journal.flush()
      const history = await readHistory(filename)
      expect(history.some((e) => e.type === 'exec')).toBe(true)
    } finally {
      await host.close()
      await journal.close()
    }
  },
  timeout,
)

test(
  'default workspace modules load and validate tools before execution',
  async () => {
    const host = await createHarness({
      cwd,
      context: defaultContext(),
      provider: script([
        () => call('write', {file: 'tool-output.txt', content: 'verified'}),
        () => call('read', {file: 'tool-output.txt'}),
        (r) => {
          expect(r.messages.at(-1)?.content).toContain('verified')
          return answer('Verified file.')
        },
      ]),
    })
    try {
      const result = await host.turn('Write and read')
      expect(result.error).toBeUndefined()
      expect(await readFile(path.join(cwd, 'tool-output.txt'), 'utf8')).toBe(
        'verified',
      )
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'external JS/TS code modules resolve kernel imports, CommonJS dependencies, and retain ESM state',
  async () => {
    const directory = await mkdtemp('/tmp/msh-external-code-')
    await writeFile(
      path.join(directory, 'helper.ts'),
      'export let count=0; export function next(){return ++count}',
    )
    await writeFile(
      path.join(directory, 'legacy.cjs'),
      'module.exports = {label: "legacy"}',
    )
    await writeFile(
      path.join(directory, 'worker.ts'),
      "import {inspect} from 'msh/kernel'\nimport {next} from './helper.ts'\nimport legacy from './legacy.cjs'\nexport default async function(){return {kind:inspect().kind,count:next(),label:legacy.label}}",
    )
    const host = await createHarness({cwd: directory})
    try {
      const first = await host.spawn({module: './worker.ts'})
      await host.wait(first)
      const second = await host.spawn({module: './worker.ts'})
      await host.wait(second)
      expect(host.inspect(first).error).toBeUndefined()
      expect(host.inspect(second).error).toBeUndefined()
      expect(host.inspect(first).result).toEqual({
        kind: 'code',
        count: 1,
        label: 'legacy',
      })
      expect(host.inspect(second).result).toEqual({
        kind: 'code',
        count: 2,
        label: 'legacy',
      })
    } finally {
      await host.close()
      await rm(directory, {recursive: true, force: true})
    }
  },
  timeout,
)
