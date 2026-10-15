import {afterAll, beforeAll, expect, test} from 'bun:test'
import {mkdtemp, rm} from 'node:fs/promises'
import path from 'node:path'
import {Client} from 'langsmith/client'
import {langsmith} from '../src/langsmith.ts'
import type {
  Completion,
  ModelRequest,
  Provider,
  RuntimeEvent,
  ToolCall,
} from '../src/types.ts'
import {createHarness} from './harness.ts'

let cwd: string
beforeAll(async () => {
  cwd = await mkdtemp(path.join(process.cwd(), '.markscript-observability-'))
})
afterAll(async () => {
  await rm(cwd, {recursive: true, force: true})
})

function events(records: RuntimeEvent[], type: string) {
  return records.filter((event) => event.type === type) as (RuntimeEvent & {
    data: Record<string, unknown>
  })[]
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {promise, resolve}
}
const answer = (content: string): Completion => ({
  message: {role: 'assistant', content},
  finishReason: 'stop',
})
const tool = (name: string, args: string, id = 'provider-call'): ToolCall => ({
  id,
  type: 'function',
  function: {name, arguments: args},
})
const call = (value: ToolCall): Completion => ({
  message: {role: 'assistant', content: null, tool_calls: [value]},
  finishReason: 'tool_calls',
})
const timeout = 60_000

test(
  'observed rounds preserve prompts, assistant reasoning, tool results, and nested ability execution',
  async () => {
    const requests: ModelRequest[] = []
    const observed: RuntimeEvent[] = []
    let flushed = false
    const completions: Completion[] = [
      {
        message: {
          role: 'assistant',
          content: 'I will double 21.',
          reasoning_content: 'Use the available arithmetic function.',
          tool_calls: [tool('twice', '{ "n": 21 }')],
        },
        finishReason: 'tool_calls',
        usage: {prompt_tokens: 27, completion_tokens: 13},
      },
      {
        ...answer('The answer is 42.'),
        usage: {prompt_tokens: 48, completion_tokens: 7},
      },
    ]
    const provider: Provider = {
      identity: {provider: 'fixture', model: 'arithmetic'},
      async complete(request, _signal, emit) {
        requests.push(structuredClone(request))
        const completion = completions[requests.length - 1]
        if (!completion) throw new Error('Unexpected model continuation')
        if (completion.message.content) {
          emit(completion.message.content.slice(0, 5))
          emit(completion.message.content.slice(5))
        }
        return completion
      },
    }
    const host = await createHarness({
      cwd,
      provider,
      maxOutputTokens: 256,
      context: {
        instructions: [
          'export function twice(n: number): number {return n * 2}\n\nExplain the calculation.',
        ],
        messages: [],
      },
      observer: {
        event(event) {
          observed.push(event)
        },
        async flush() {
          flushed = true
        },
      },
    })
    try {
      const state = await host.turn('Double 21')
      expect(state.error).toBeUndefined()
      expect(state.messages.at(-1)?.content).toBe('The answer is 42.')
      expect(requests[1]?.messages.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'provider-call',
        content: '42',
      })

      const starts = events(observed, 'model.start')
      const ends = events(observed, 'model.end')
      expect(starts).toHaveLength(2)
      expect(ends).toHaveLength(2)
      expect(new Set(starts.map((event) => event.data.id)).size).toBe(2)
      expect(new Set(starts.map((event) => event.invocation)).size).toBe(1)
      for (const [index, start] of starts.entries()) {
        const completion = completions[index]
        expect(start.data).toMatchObject({
          invocation: start.invocation,
          step: index,
          identity: provider.identity,
          purpose: 'turn',
          request: requests[index],
        })
        expect(ends[index]?.data).toMatchObject({
          id: start.data.id,
          invocation: start.invocation,
          step: index,
          message: completion?.message,
          usage: completion?.usage,
          finishReason: completion?.finishReason,
        })
        expect(
          events(observed, 'stream')
            .filter((event) => event.data.id === start.data.id)
            .map((event) => event.data.text)
            .join(''),
        ).toBe(completion?.message.content ?? '')
      }
      const firstRequest = starts[0]?.data.request as ModelRequest
      expect(firstRequest.messages[0]?.content).toContain(
        'Explain the calculation.',
      )
      expect(firstRequest.messages.at(-1)?.content).toBe('Double 21')
      expect(
        firstRequest.tools.some((item) => item.function.name === 'twice'),
      ).toBe(true)
      expect(firstRequest.maxOutputTokens).toBe(256)

      const start = events(observed, 'tool.start')[0]
      const end = events(observed, 'tool.end')[0]
      expect(start?.data).toMatchObject({
        id: 'provider-call',
        name: 'twice',
        arguments: '{ "n": 21 }',
        invocation: starts[0]?.invocation,
      })
      expect(start?.data.span).toBeString()
      expect(end?.data).toMatchObject({
        id: 'provider-call',
        span: start?.data.span,
        result: 42,
      })
      expect(end?.data.error).toBeUndefined()
      const ability = events(observed, 'activity.start').find(
        (event) => event.data.kind === 'ability' && event.data.name === 'twice',
      )
      expect(start?.data.span).toBe(ability?.parentSpan)
      expect(
        events(observed, 'activity.end').find(
          (event) => event.data.id === ability?.data.id,
        )?.data.output,
      ).toBe(42)
    } finally {
      await host.close()
    }
    expect(flushed).toBe(true)
    expect(observed).toEqual(host.events)
    expect(events(observed, 'thread.state').at(-1)?.data.state).toBe('dead')
  },
  timeout,
)

test(
  'a failed tool records its original arguments and error while a later round recovers',
  async () => {
    let round = 0
    const host = await createHarness({
      cwd,
      provider: {
        async complete(request) {
          if (round++ === 0) return call(tool('inspect', '{invalid'))
          expect(request.messages.at(-1)?.role).toBe('tool')
          expect(
            JSON.parse(request.messages.at(-1)?.content ?? '{}').error,
          ).toBeString()
          return answer('Recovered from the invalid arguments.')
        },
      },
    })
    try {
      const state = await host.turn('Inspect the thread')
      expect(state.error).toBeUndefined()
      const start = events(host.events, 'tool.start')[0]
      const end = events(host.events, 'tool.end')[0]
      expect(start?.data.arguments).toBe('{invalid')
      expect(end?.data).toMatchObject({
        span: start?.data.span,
        id: 'provider-call',
        name: 'inspect',
      })
      expect(end?.data.error).toBeString()
      expect(end?.data.result).toEqual({error: end?.data.error})
      expect(events(host.events, 'model.end')).toHaveLength(2)
      expect(state.messages.at(-1)?.content).toBe(
        'Recovered from the invalid arguments.',
      )
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'provider failures close the partial round and preserve the next invocation',
  async () => {
    let round = 0
    const host = await createHarness({
      cwd,
      provider: {
        async complete(_request, _signal, emit) {
          if (round++ > 0) return answer('The retry succeeded.')
          emit('A partial ')
          emit('answer')
          throw new Error('Provider connection lost')
        },
      },
    })
    try {
      expect((await host.turn('Begin')).error).toBe('Provider connection lost')
      const failed = events(host.events, 'model.start')[0]
      expect(events(host.events, 'model.error')[0]?.data).toMatchObject({
        id: failed?.data.id,
        invocation: failed?.invocation,
        error: 'Provider connection lost',
        cancelled: false,
        partialText: 'A partial answer',
      })
      expect(events(host.events, 'model.end')).toHaveLength(0)
      expect((await host.turn('Try again')).error).toBeUndefined()
      const next = events(host.events, 'model.start')[1]
      expect(next?.invocation).not.toBe(failed?.invocation)
      expect(events(host.events, 'model.end')[0]?.data).toMatchObject({
        id: next?.data.id,
        message: {role: 'assistant', content: 'The retry succeeded.'},
      })
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'interrupt records partial output and rejects late events from a noncooperative provider',
  async () => {
    const started = deferred()
    const release = deferred()
    const settled = deferred()
    let round = 0
    const host = await createHarness({
      cwd,
      provider: {
        async complete(_request, _signal, emit) {
          if (round++ > 0) return answer('New invocation completed.')
          emit('Before interruption')
          started.resolve()
          await release.promise
          emit('Late output from the interrupted request')
          settled.resolve()
          return answer('Stale completion')
        },
      },
    })
    try {
      const turn = host.turn('Begin')
      await started.promise
      await host.send(host.root, {control: 'interrupt'})
      expect((await turn).state).toBe('idle')
      const first = events(host.events, 'model.start')[0]
      expect(events(host.events, 'model.error')[0]?.data).toMatchObject({
        id: first?.data.id,
        cancelled: true,
        partialText: 'Before interruption',
      })
      await host.turn('Continue')
      const sequence = host.events.length
      release.resolve()
      await settled.promise
      await Promise.resolve()
      expect(host.events).toHaveLength(sequence)
      expect(
        events(host.events, 'stream').map((event) => event.data.text),
      ).toEqual(['Before interruption'])
      expect(events(host.events, 'model.end')).toHaveLength(1)
      expect(host.inspect().messages.at(-1)?.content).toBe(
        'New invocation completed.',
      )
    } finally {
      release.resolve()
      await host.close()
    }
  },
  timeout,
)

test(
  'concurrent child rounds correlate reused provider call IDs to distinct execution spans',
  async () => {
    const started = deferred()
    const release = deferred()
    let active = 0
    const host = await createHarness({
      cwd,
      provider: {
        async complete(request) {
          const result = request.messages.find(
            (message) => message.role === 'tool',
          )
          if (result) {
            const state = JSON.parse(result.content ?? '{}')
            return answer(`Inspected ${state.id}`)
          }
          if (++active === 2) started.resolve()
          await release.promise
          return call(tool('inspect', '{"last_k_msg":1}', 'shared-provider-id'))
        },
      },
    })
    try {
      const first = await host.spawn({
        instructions: [],
        messages: ['First child'],
      })
      const second = await host.spawn({
        instructions: [],
        messages: ['Second child'],
      })
      await started.promise
      release.resolve()
      await Promise.all([host.wait(first), host.wait(second)])
      const starts = events(host.events, 'tool.start')
      expect(starts).toHaveLength(2)
      expect(new Set(starts.map((event) => event.data.span)).size).toBe(2)
      expect(new Set(starts.map((event) => event.invocation)).size).toBe(2)
      expect(starts.map((event) => event.data.id)).toEqual([
        'shared-provider-id',
        'shared-provider-id',
      ])
      for (const start of starts) {
        const end = events(host.events, 'tool.end').find(
          (event) => event.data.span === start.data.span,
        )
        expect(end?.thread).toBe(start.thread)
        expect(end?.invocation).toBe(start.invocation)
        expect(end?.data.result).toMatchObject({id: start.thread})
        expect(host.inspect(start.thread).messages.at(-1)?.content).toBe(
          `Inspected ${start.thread}`,
        )
        const rounds = events(host.events, 'model.start').filter(
          (event) => event.thread === start.thread,
        )
        expect(rounds.map((event) => event.data.step)).toEqual([0, 1])
        expect(new Set(rounds.map((event) => event.data.invocation))).toEqual(
          new Set([start.invocation]),
        )
      }
    } finally {
      release.resolve()
      await host.close()
    }
  },
  timeout,
)

test(
  'interrupting a suspended tool closes its span and keeps one paired result for the next turn',
  async () => {
    const waiting = deferred()
    let round = 0
    const host = await createHarness({
      cwd,
      onEvent(event) {
        if (
          event.type === 'thread.state' &&
          (event.data as {state: string}).state === 'waiting'
        )
          waiting.resolve()
      },
      provider: {
        async complete(request) {
          if (round++ === 0) return call(tool('wait', '{}'))
          const results = request.messages.filter(
            (message) => message.tool_call_id === 'provider-call',
          )
          expect(results).toHaveLength(1)
          expect(JSON.parse(results[0]?.content ?? '{}')).toMatchObject({
            error: 'Interrupted',
          })
          return answer('Continued after interruption.')
        },
      },
    })
    try {
      const turn = host.turn('Wait for a message')
      await waiting.promise
      await host.send(host.root, {control: 'interrupt'})
      const interrupted = await turn
      expect(interrupted.state).toBe('idle')
      expect(
        interrupted.messages.filter(
          (message) => message.tool_call_id === 'provider-call',
        ),
      ).toHaveLength(1)
      const start = events(host.events, 'tool.start')[0]
      const ends = events(host.events, 'tool.end').filter(
        (event) => event.data.span === start?.data.span,
      )
      expect(ends).toHaveLength(1)
      expect(ends[0]?.data).toMatchObject({
        id: 'provider-call',
        name: 'wait',
        cancelled: true,
        error: 'Interrupted',
        result: {error: 'Interrupted'},
      })
      const continued = await host.turn('Continue')
      expect(continued.error).toBeUndefined()
      expect(continued.messages.at(-1)?.content).toBe(
        'Continued after interruption.',
      )
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'successful exec closes its tool span as a context transfer and continues the invocation',
  async () => {
    let round = 0
    const host = await createHarness({
      cwd,
      provider: {
        async complete(request) {
          if (round++ === 0)
            return call(
              tool(
                'exec',
                JSON.stringify({
                  instructions: ['New instructions'],
                  messages: [],
                }),
              ),
            )
          expect(request.messages[0]?.content).toContain('New instructions')
          return answer('Context replaced successfully.')
        },
      },
    })
    try {
      const state = await host.turn('Replace context')
      expect(state.generation).toBe(1)
      expect(state.error).toBeUndefined()
      const start = events(host.events, 'tool.start')[0]
      const ends = events(host.events, 'tool.end').filter(
        (event) => event.data.span === start?.data.span,
      )
      expect(ends).toHaveLength(1)
      expect(ends[0]?.data).toMatchObject({
        id: start?.data.id,
        name: 'exec',
        transferred: true,
        result: {generation: 1},
      })
      expect(ends[0]?.data.error).toBeUndefined()
      expect(
        events(host.events, 'model.start').map((event) => event.data.step),
      ).toEqual([0, 1])
      expect(events(host.events, 'model.error')).toHaveLength(0)
    } finally {
      await host.close()
    }
  },
  timeout,
)

test(
  'the runtime exports complete LangSmith round content and closes transferred and interrupted spans',
  async () => {
    type Run = Parameters<Client['createRun']>[0] &
      Parameters<Client['updateRun']>[1]
    const runs = new Map<string, Run>()
    const client = new Client({apiKey: 'fixture', autoBatchTracing: false})
    client.createRun = async (run) => {
      if (!run.id) throw new Error('Run ID is required')
      runs.set(run.id, structuredClone(run))
    }
    client.updateRun = async (id, update) => {
      const run = runs.get(id)
      if (!run) throw new Error('Run must be created before updating')
      Object.assign(run, structuredClone(update))
    }
    client.awaitPendingTraceBatches = async () => {}
    const observer = langsmith({enabled: true, project: 'fixture', client})
    if (!observer) throw new Error('Expected an enabled observer')
    const started = deferred()
    const release = deferred()
    const requests: ModelRequest[] = []
    const transfer: Completion = {
      message: {
        role: 'assistant',
        content: 'Switching to fresh instructions.',
        reasoning_content: 'Preserve the thread while replacing its context.',
        tool_calls: [
          tool(
            'exec',
            JSON.stringify({
              instructions: ['Fresh instructions'],
              messages: [],
            }),
          ),
        ],
      },
      finishReason: 'tool_calls',
      usage: {prompt_tokens: 30, completion_tokens: 12},
    }
    const host = await createHarness({
      cwd,
      observer,
      provider: {
        identity: {provider: 'fixture', model: 'trace-model'},
        async complete(request, _signal, emit) {
          requests.push(structuredClone(request))
          if (requests.length === 1) {
            emit(transfer.message.content ?? '')
            return transfer
          }
          if (requests.length === 2) return answer('Fresh context is ready.')
          emit('Interrupted partial text')
          started.resolve()
          await release.promise
          return answer('Stale completion')
        },
      },
    })
    try {
      expect((await host.turn('Replace the context')).error).toBeUndefined()
      const interrupted = host.turn('Begin a long answer')
      await started.promise
      await host.send(host.root, {control: 'interrupt'})
      await interrupted
      await observer.flush()

      const rounds = [...runs.values()].filter((run) => run.run_type === 'llm')
      expect(rounds).toHaveLength(3)
      for (const [index, round] of rounds.entries()) {
        expect(round.inputs).toEqual({...requests[index]})
        expect(round.extra?.metadata).toMatchObject({
          thread_id: host.root,
          ls_provider: 'fixture',
          ls_model_name: 'trace-model',
          purpose: 'turn',
        })
        expect(round.end_time).toBeDefined()
        const parent = runs.get(round.parent_run_id ?? '')
        expect(parent?.name).toBe('msh.turn')
        expect(parent?.trace_id).toBe(round.trace_id)
      }
      expect(rounds[0]?.outputs).toMatchObject({
        choices: [
          {index: 0, message: transfer.message, finish_reason: 'tool_calls'},
        ],
        usage_metadata: {input_tokens: 30, output_tokens: 12, total_tokens: 42},
      })
      expect(rounds[0]?.events).toContainEqual(
        expect.objectContaining({
          name: 'stream',
          kwargs: expect.objectContaining({token: transfer.message.content}),
        }),
      )
      expect(
        rounds[0]?.events?.filter((event) => event.name === 'new_token'),
      ).toHaveLength(1)
      const exec = [...runs.values()].find((run) => run.run_type === 'tool')
      expect(exec?.name).toBe('exec')
      expect(exec?.parent_run_id).toBe(rounds[0]?.parent_run_id)
      expect(exec?.outputs).toEqual({
        output: {generation: 1},
        transferred: true,
      })
      expect(exec?.error).toBeUndefined()
      expect(exec?.extra?.metadata.status).toBe('transferred')
      expect(rounds[2]?.outputs).toEqual({
        partial_text: 'Interrupted partial text',
      })
      expect(rounds[2]?.extra?.metadata.status).toBe('cancelled')
      expect(rounds[2]?.error).toBeString()
    } finally {
      release.resolve()
      await host.close()
    }
    expect([...runs.values()].every((run) => run.end_time !== undefined)).toBe(
      true,
    )
  },
  timeout,
)
