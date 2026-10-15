import {expect, test} from 'bun:test'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import type {Agent} from '../src/agent.ts'
import {useContext} from '../src/context.ts'
import {parseConversation, validateConversation} from '../src/conversation.ts'
import {defineExtension} from '../src/extensions.ts'
import {createHarness} from '../src/host.ts'
import {compact} from '../src/presets.ts'
import {createHarness as createShell} from './harness.ts'

async function fixture(files: Record<string, string>) {
  const cwd = await mkdtemp('/tmp/msh-extensions-')
  for (const [name, source] of Object.entries(files))
    await writeFile(path.join(cwd, name), source)
  return cwd
}

test('the bare kernel retains ordinary exports and accepts callable arguments without a model adapter', async () => {
  const host = await createHarness({
    context: {
      instructions: [
        'export const label = "core"\nexport function apply(fn: (n: number) => number): number {return fn(3)}',
      ],
      messages: ['{throw new Error("inert context")}'],
    },
  })
  try {
    expect(host.inspect().kind).toBe('context')
    expect(host.inspect().modules[0]).toEqual(
      host.inspect().context.instructions[0],
    )
    expect(host.inspect().bindings.map((b) => b.name)).toEqual([
      'label',
      'apply',
    ])
    expect(await host.invoke(host.root, 'apply', [(n: number) => n * 2])).toBe(
      6,
    )
    expect(host.events.some((e) => e.type === 'model.start')).toBe(false)
    expect(host.service('msh.agent')).toBeUndefined()
  } finally {
    await host.close()
  }
})

test('cached ESM extensions activate independently per context and repeated imports keep one installation', async () => {
  const cwd = await fixture({
    'feature.ts': `
import {defineExtension} from 'msh/core'
export const instances: string[] = []
export const disposed: string[] = []
export const feature = defineExtension('test.feature', scope => {
  instances.push(scope.thread!)
  scope.provide('test.feature', {thread: scope.thread})
  scope.hook('input', async ({thread}: {thread: string}) => {await scope.host.receive(thread)})
  return () => {disposed.push(scope.thread!)}
})
`,
  })
  const source = 'import "./feature.ts"\n\n# Context'
  const host = await createHarness({
    cwd,
    context: {instructions: [source], messages: []},
  })
  try {
    const child = await host.spawn({instructions: [source], messages: []})
    await host.wait(child)
    const module = await import(path.join(cwd, 'feature.ts'))
    expect(module.instances).toEqual([host.root, child])
    expect(host.service<{thread: string}>('test.feature', host.root)).toEqual({
      thread: host.root,
    })
    expect(host.service<{thread: string}>('test.feature', child)).toEqual({
      thread: child,
    })
    await host.evaluate(child, [source])
    expect(module.instances).toHaveLength(2)
    await host.replaceIdle(child, {instructions: [], messages: []})
    expect(
      host.service<{thread: string}>('test.feature', child),
    ).toBeUndefined()
    expect(host.service<{thread: string}>('test.feature', host.root)).toEqual({
      thread: host.root,
    })
    expect(module.disposed).toEqual([child])
    await host.close()
    expect(module.disposed).toEqual([child, host.root])
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
})

test('a failed installation withdraws staged hooks and services and never starts its runners', async () => {
  const cwd = await fixture({
    'feature.ts': `
import {defineExtension} from 'msh/core'
export let ran = 0
export let cleaned = 0
export const feature = defineExtension('test.broken', scope => {
  scope.provide('test.broken', true)
  scope.hook('action.before', () => {throw new Error('leaked hook')})
  scope.run(async () => {ran++})
  scope.cleanup(() => {cleaned++})
  throw new Error('setup failed')
})
`,
  })
  const host = await createHarness({
    cwd,
    context: {
      instructions: ['export function kept(): number {return 7}'],
      messages: [],
    },
  })
  try {
    await expect(
      host.execute(host.root, () =>
        host.replace(host.root, {
          instructions: ['import "./feature.ts"'],
          messages: [],
        }),
      ),
    ).rejects.toThrow('setup failed')
    expect(host.inspect().generation).toBe(0)
    expect(host.service('test.broken', host.root)).toBeUndefined()
    expect(await host.invoke(host.root, 'kept', [])).toBe(7)
    const module = await import(path.join(cwd, 'feature.ts'))
    expect(module.ran).toBe(0)
    expect(module.cleaned).toBe(1)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
})

test('hooks await in registration order and event subscribers observe without changing invocation', async () => {
  const calls: string[] = []
  const host = await createHarness({
    extensions: [
      defineExtension('test.order', (scope) => {
        scope.hook('action.before', async () => {
          await Promise.resolve()
          calls.push('first')
        })
        scope.hook('action.before', () => {
          calls.push('second')
        })
        scope.on('action.before', () => {
          calls.push('event')
          throw new Error('observer failure')
        })
        scope.on('action.before', async () => {
          await Promise.resolve()
          throw new Error('async observer failure')
        })
      }),
    ],
    context: {
      instructions: ['export function value(): number {return 4}'],
      messages: [],
    },
  })
  try {
    expect(await host.invoke(host.root, 'value', [])).toBe(4)
    expect(calls).toEqual(['event', 'first', 'second'])
  } finally {
    await host.close()
  }
})

test('owned runners start after bindings commit and cancellation withdraws their execution scope', async () => {
  const cwd = await fixture({
    'runner.ts': `
import {defineExtension} from 'msh/core'
export let cleaned = false
export const feature = defineExtension('test.runner', scope => {
  scope.run(async context => {
    scope.provide('started', scope.host.inspect(context.thread).bindings.map(b => b.name))
    await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), {once:true}))
    context.signal.throwIfAborted()
    scope.provide('late', true)
  })
  return () => {cleaned = true}
})
`,
  })
  const host = await createHarness({
    cwd,
    context: {
      instructions: ['import "./runner.ts"\nexport const committed = 1'],
      messages: [],
    },
  })
  try {
    await Promise.resolve()
    expect(host.service<string[]>('started', host.root)).toEqual(['committed'])
    await host.send(host.root, {control: 'terminate'})
    await host.wait(host.root)
    expect(host.inspect().state).toBe('dead')
    expect(host.service('late', host.root)).toBeUndefined()
    expect((await import(path.join(cwd, 'runner.ts'))).cleaned).toBe(true)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
})

test('an imported agent equips a bare context and its emissions use the generic evaluator', async () => {
  const cwd = await fixture({
    'agent.ts': `
import {agent} from 'msh/agent'
export const feature = agent(() => {
  let step = 0
  return {provider: {async complete() {
    return {message: {role: 'assistant', content: step++ === 0 ? 'export function added(): number {return 9}\\n\\n{String(added())}' : 'Done'}, finishReason: 'stop'}
  }}}
})
`,
  })
  const host = await createHarness({
    cwd,
    context: {instructions: ['import "./agent.ts"'], messages: []},
  })
  try {
    await host.send(host.root, ':::user\nStart\n:::')
    await host.wait(host.root)
    expect(host.inspect().error).toBeUndefined()
    expect(await host.invoke(host.root, 'added', [])).toBe(9)
    const agent = host.service<Agent>('msh.agent', host.root)
    expect(agent?.inspect(host.root).messages.at(-1)?.content).toBe('Done')
    await host.replaceIdle(host.root, {instructions: [], messages: []})
    expect(host.service('msh.agent', host.root)).toBeUndefined()
    expect(host.inspect().generation).toBe(1)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 30_000)

test('late completion of a cancelled hook cannot start its invocation', async () => {
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let invoked = false
  const host = await createHarness({
    extensions: [
      defineExtension('test.gate', (scope) => {
        scope.hook('action.before', async () => {
          entered()
          await gate
        })
      }),
    ],
  })
  try {
    const child = await host.spawn({
      default: async () => {
        invoked = true
        return useContext().thread
      },
    })
    await started
    await host.send(child, {control: 'interrupt'})
    await host.wait(child)
    release()
    await Promise.resolve()
    expect(invoked).toBe(false)
    expect(host.inspect(child).state).toBe('dead')
  } finally {
    release()
    await host.close()
  }
})

test('code modules activate imported extensions before their entry and dispose them on return', async () => {
  const cwd = await fixture({
    'feature.ts': `
import {defineExtension} from 'msh/core'
export let disposed = false
export const feature = defineExtension('test.code', scope => {
  scope.provide('test.code', 'installed')
  return () => {disposed = true}
})
`,
    'entry.ts': `
import './feature.ts'
import {useContext} from 'msh/core'
export default function() {const c = useContext(); return c.host.service('test.code', c.thread)}
`,
  })
  const host = await createHarness({cwd})
  try {
    const child = await host.spawn({module: './entry.ts'})
    await host.wait(child)
    expect(host.inspect(child).result).toBe('installed')
    expect((await import(path.join(cwd, 'feature.ts'))).disposed).toBe(true)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
})

test('context transfer reinstalls an imported agent and retains complete historical exchanges', async () => {
  const cwd = await fixture({
    'agent.ts': `
import {agent} from 'msh/agent'
export const feature = agent(() => ({provider: {async complete(request) {
  if (request.messages.some(m => m.role === 'user' && m.content === 'Continue')) return {message:{role:'assistant',content:'Continued'}, finishReason:'stop'}
  return {message:{role:'assistant',content:null,tool_calls:[{id:'replace',type:'function',function:{name:'exec',arguments:JSON.stringify({instructions:['import "./agent.ts"'],messages:[${JSON.stringify(':::user\nContinue\n:::')}]})}}]},finishReason:'tool_calls'}
}}}))
`,
  })
  const host = await createHarness({
    cwd,
    context: {instructions: ['import "./agent.ts"'], messages: []},
  })
  try {
    await host.send(host.root, ':::user\nStart\n:::')
    await host.wait(host.root)
    expect(host.inspect().error).toBeUndefined()
    expect(host.inspect().generation).toBe(1)
    const agent = host.service<Agent>('msh.agent', host.root)
    const state = agent?.inspect(host.root, 0)
    expect(state?.messages.at(-1)?.content).toBe('Continued')
    expect(state?.conversation).toContain('Start')
    expect(() =>
      validateConversation(parseConversation(state?.conversation ?? '')),
    ).not.toThrow()
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 30_000)

test('compaction retains imported extensions and terminated threads retain their conversation view', async () => {
  const cwd = await fixture({
    'agent.ts': `
import {agent} from 'msh/agent'
export const feature = agent(() => ({provider: {async complete(request) {
  return {message:{role:'assistant',content:request.purpose === 'compaction' ? 'Retained task' : 'Local agent'},finishReason:'stop'}
}}}))
`,
  })
  const host = await createShell({
    cwd,
    context: {
      instructions: [
        'import "./agent.ts"\nexport function kept(): number {return 1}',
      ],
      messages: [],
    },
  })
  try {
    expect((await host.turn('Original task')).messages.at(-1)?.content).toBe(
      'Local agent',
    )
    expect(host.inspect().extensions.map((e) => e.name)).toEqual(['msh.agent'])
    await compact(host)
    expect(host.inspect().error).toBeUndefined()
    expect(host.inspect().extensions.map((e) => e.name)).toEqual(['msh.agent'])
    expect(host.inspect().conversation).toContain('Original task')
    await host.send(host.root, {control: 'terminate'})
    await host.wait(host.root)
    expect(host.inspect().conversation).toContain('Local agent')
    expect(host.inspect().state).toBe('dead')
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 30_000)

test('running invocations keep their captured implementation while later calls use replacement bindings', async () => {
  const host = await createHarness({
    context: {
      instructions: [
        'export async function version(gate: Promise<void>): Promise<number> {await gate; return 1}',
      ],
      messages: [],
    },
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const running = host.invoke(host.root, 'version', [gate])
    await Promise.resolve()
    await host.evaluate(host.root, [
      'export function version(): number {return 2}',
    ])
    release()
    expect(await running).toBe(1)
    expect(await host.invoke(host.root, 'version', [])).toBe(2)
  } finally {
    release()
    await host.close()
  }
})

test('external invocations participate in interruption and the context can execute again', async () => {
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  let blocked = true
  const host = await createHarness({
    extensions: [
      defineExtension('test.invoke', (scope) => {
        scope.hook('action.before', async () => {
          if (blocked) {
            entered()
            await new Promise<void>(() => {})
          }
        })
      }),
    ],
    context: {
      instructions: ['export function value(): number {return 1}'],
      messages: [],
    },
  })
  try {
    const operation = host.invoke(host.root, 'value', [])
    const cancelled = operation.then(
      () => new Error('Operation unexpectedly completed'),
      (error) => error as Error,
    )
    await started
    expect(host.inspect().state).toBe('running')
    await host.send(host.root, {control: 'interrupt'})
    expect((await cancelled).message).toBe('Interrupted')
    await host.wait(host.root)
    expect(host.inspect().state).toBe('idle')
    blocked = false
    expect(await host.invoke(host.root, 'value', [])).toBe(1)
  } finally {
    await host.close()
  }
})

test('agent request limits apply across repeated context transfers', async () => {
  const cwd = await fixture({
    'agent.ts': `
import {agent} from 'msh/agent'
export const feature = agent(() => ({maxTurns: 3, provider: {async complete() {
  return {message:{role:'assistant',content:${JSON.stringify('{exec({instructions:[\'import "./agent.ts"\'],messages:[]})}')}},finishReason:'stop'}
}}}))
`,
  })
  const host = await createHarness({
    cwd,
    context: {instructions: ['import "./agent.ts"'], messages: []},
  })
  try {
    await host.send(host.root, 'Start')
    await host.wait(host.root)
    expect(host.inspect().error).toContain('Turn reached 3 model requests')
    expect(host.events.filter((e) => e.type === 'model.start')).toHaveLength(3)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 30_000)

test('cleanup failure preserves the committed replacement and remaining cleanup still runs', async () => {
  const cwd = await fixture({
    'feature.ts': `
import {defineExtension} from 'msh/core'
export let second = false
export const feature = defineExtension('test.cleanup', scope => {
  scope.cleanup(() => {second = true})
  scope.cleanup(() => {throw new Error('cleanup fixture')})
})
`,
  })
  const host = await createHarness({
    cwd,
    context: {instructions: ['import "./feature.ts"'], messages: []},
  })
  try {
    await host.replaceIdle(host.root, {
      instructions: ['export function replacement(): number {return 2}'],
      messages: [],
    })
    expect(host.inspect().generation).toBe(1)
    expect(await host.invoke(host.root, 'replacement', [])).toBe(2)
    expect((await import(path.join(cwd, 'feature.ts'))).second).toBe(true)
    expect(
      host.events.filter((e) => e.type === 'cleanup.error').map((e) => e.data),
    ).toEqual([
      {message: 'Extension cleanup failed', causes: ['cleanup fixture']},
    ])
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
})

test('the agent rejects unsupported tool signatures before their module effects', async () => {
  const marker = path.join('/tmp', `msh-module-effect-${crypto.randomUUID()}`)
  const cwd = await fixture({
    'invalid.ms': `
import {writeFileSync} from 'node:fs'
export const evaluated = (() => {writeFileSync(${JSON.stringify(marker)}, 'effect'); return true})()
export function unsafe(input: unknown) {return input}

# Invalid tool
`,
  })
  const host = await createShell({cwd})
  try {
    await expect(
      host.runtime.evaluate(host.root, [{module: './invalid.ms'}]),
    ).rejects.toThrow('Unsupported tool parameter type: unknown')
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(host.runtime.bindings(host.root).has('unsafe')).toBe(false)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
    await rm(marker, {force: true})
  }
})

test('importing an agent during a turn transfers the driver and retains the native interface and abilities', async () => {
  const cwd = await fixture({
    'agent.ts': `
import {agent} from 'msh/agent'
export const feature = agent(() => ({provider: {async complete(request) {
  if (request.messages.some(m => m.role === 'tool' && m.tool_call_id === 'retained')) return {message:{role:'assistant',content:'Imported agent complete'},finishReason:'stop'}
  return {message:{role:'assistant',content:null,tool_calls:[{id:'retained',type:'function',function:{name:'kept',arguments:JSON.stringify({value:21})}}]},finishReason:'tool_calls'}
}}}))
`,
  })
  let originalRequests = 0
  const host = await createShell({
    cwd,
    provider: {
      async complete() {
        originalRequests++
        return {
          message: {
            role: 'assistant',
            content: 'import "./agent.ts"\n\n{String(kept(2))}',
          },
          finishReason: 'stop',
        }
      },
    },
    context: {
      instructions: [
        'export function kept(value: number): number {return value * 2}',
      ],
      messages: [],
    },
  })
  try {
    const state = await host.turn('Use the imported agent')
    expect(state.error).toBeUndefined()
    expect(originalRequests).toBe(1)
    expect(state.messages.at(-1)?.content).toBe('Imported agent complete')
    expect(
      state.messages.find((m) => m.tool_call_id === 'retained')?.content,
    ).toBe('42')
    expect(state.abilities.map((a) => a.name)).toContain('kept')
    expect(state.nativeTools.map((t) => t.function.name)).toContain('kept')
    expect(() =>
      validateConversation(parseConversation(state.conversation)),
    ).not.toThrow()
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 30_000)

test('a failed host extension closes all registrations already acquired during setup', async () => {
  let disposed = false
  let started = false
  await expect(
    createHarness({
      extensions: [
        defineExtension('test.host.failure', async (scope) => {
          scope.cleanup(() => {
            disposed = true
          })
          scope.run(async () => {
            started = true
          })
          throw new Error('host setup failed')
        }),
      ],
    }),
  ).rejects.toThrow('host setup failed')
  expect(disposed).toBe(true)
  expect(started).toBe(false)
})

test('descriptors exported by the evaluated document activate before its body renders', async () => {
  const host = await createHarness({
    context: {
      instructions: [
        `
import {defineExtension, useContext} from 'msh/core'
export const feature = defineExtension('test.document', scope => {scope.provide('test.document', 'Ready')})

{String(useContext().registration?.get('test.document'))}
`,
      ],
      messages: [],
    },
  })
  try {
    expect(host.inspect().context.instructions[0]?.text.trim()).toBe('Ready')
    expect(host.service<string>('test.document', host.root)).toBe('Ready')
  } finally {
    await host.close()
  }
})

test('importing the first agent adopts the existing generic context and exports', async () => {
  const cwd = await fixture({
    'agent.ts': `
import {agent} from 'msh/agent'
import type {ModelRequest} from 'msh'
export const requests: ModelRequest[] = []
export const feature = agent(() => ({provider: {async complete(request) {
  requests.push(request)
  if (request.messages.some(m => m.tool_call_id === 'adopted')) return {message:{role:'assistant',content:'Adopted context'},finishReason:'stop'}
  return {message:{role:'assistant',content:null,tool_calls:[{id:'adopted',type:'function',function:{name:'kept',arguments:'{"value":21}'}}]},finishReason:'tool_calls'}
}}}))
`,
  })
  const host = await createHarness({
    cwd,
    context: {
      instructions: [
        `
export function kept(value: number): number {return value * 2}

# Durable instructions
`,
      ],
      messages: [':::user\nOriginal request\n:::'],
    },
  })
  try {
    await host.evaluate(host.root, ['import "./agent.ts"'])
    await host.send(host.root, ':::user\nContinue\n:::')
    await host.wait(host.root)
    const state = host
      .service<Agent>('msh.agent', host.root)
      ?.inspect(host.root, 0)
    const imported = await import(path.join(cwd, 'agent.ts'))
    expect(host.inspect().error).toBeUndefined()
    expect(imported.requests[0].messages[0].content).toContain(
      'Durable instructions',
    )
    expect(
      imported.requests[0].messages.some(
        (m: {content: string}) => m.content === 'Original request',
      ),
    ).toBe(true)
    expect(
      state?.messages.find((m) => m.tool_call_id === 'adopted')?.content,
    ).toBe('42')
    expect(state?.messages.at(-1)?.content).toBe('Adopted context')
    expect(state?.abilities.map((a) => a.name)).toContain('kept')
    expect(() =>
      validateConversation(parseConversation(state?.conversation ?? '')),
    ).not.toThrow()
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 30_000)

test('binding installation captures exported values and callables after document evaluation', async () => {
  const host = await createHarness({
    context: {
      instructions: [
        `
export let count = 0
export let current = () => 1

{(() => {count++; current = () => 9; return String(count)})()}
`,
      ],
      messages: [],
    },
  })
  try {
    expect(host.bindings(host.root).get('count')?.value).toBe(1)
    expect(await host.invoke(host.root, 'current', [])).toBe(9)
    expect(host.inspect().context.instructions[0]?.text.trim()).toBe('1')
  } finally {
    await host.close()
  }
})
