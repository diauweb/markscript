import {expect, test} from 'bun:test'
import {Client} from 'langsmith/client'
import type {RunCreate} from 'langsmith/schemas'
import {langsmith} from '../src/langsmith.ts'
import type {RuntimeEvent} from '../src/types.ts'

class RecordingClient extends Client {
  readonly recordedRuns = new Map<string, RunCreate>()
  readonly operations: {type: string; id: string}[] = []
  failure?: 'create' | 'update' | 'flush'
  constructor() {
    super({
      apiUrl: 'https://traces.test',
      apiKey: 'test',
      autoBatchTracing: false,
    })
  }
  override async createRun(run: Parameters<Client['createRun']>[0]) {
    if (this.failure === 'create') throw new Error('create failed')
    if (!run.id) throw new Error('run requires an id')
    this.operations.push({type: 'create', id: run.id})
    this.recordedRuns.set(run.id, structuredClone(run))
  }
  override async updateRun(
    id: string,
    run: Parameters<Client['updateRun']>[1],
  ) {
    if (this.failure === 'update') throw new Error('update failed')
    this.operations.push({type: 'update', id})
    const existing = this.recordedRuns.get(id)
    if (!existing) throw new Error('updated before created')
    this.recordedRuns.set(id, {...existing, ...structuredClone(run)})
  }
  override async awaitPendingTraceBatches() {
    if (this.failure === 'flush') throw new Error('flush failed')
  }
}

function fixture() {
  const client = new RecordingClient()
  const observer = langsmith({enabled: true, project: 'msh-test', client})
  if (!observer) throw new Error('tracing is disabled')
  let seq = 0
  const emit = (
    type: string,
    data: unknown,
    context: Partial<
      Pick<RuntimeEvent, 'thread' | 'invocation' | 'span' | 'parentSpan'>
    > = {},
  ) => {
    const event: RuntimeEvent = {
      seq: ++seq,
      time: new Date(Date.UTC(2026, 9, 3, 0, 0, seq)).toISOString(),
      thread: 'root',
      type,
      data,
      ...context,
    }
    observer.event(event)
    return event
  }
  const all = () => [...client.recordedRuns.values()]
  const find = (predicate: (run: RunCreate) => boolean) => {
    const run = all().find(predicate)
    if (!run) throw new Error('trace run not found')
    return run
  }
  return {client, observer, emit, all, find}
}

const request = {
  messages: [
    {role: 'system', content: 'Solve the task carefully'},
    {role: 'user', content: 'Add 2 and 3'},
  ],
  tools: [
    {
      type: 'function',
      function: {name: 'add', description: 'Add', parameters: {type: 'object'}},
    },
  ],
  purpose: 'turn',
  maxOutputTokens: 256,
}
const identity = {provider: 'fixture', model: 'fixture-model'}

test('LangSmith exports conversation rounds, reasoning, tokens, tools and nested child execution', async () => {
  const f = fixture()
  const created = f.emit('thread.created', {kind: 'llm', cwd: '/tmp'})
  const turn = {invocation: 'turn-1'}
  f.emit('thread.state', {state: 'running', invocation: turn.invocation}, turn)
  const modelStart = f.emit(
    'model.start',
    {id: 'round-1', step: 0, identity, request},
    turn,
  )
  const token = f.emit('stream', {id: 'round-1', text: 'Calling add'}, turn)
  const message = {
    role: 'assistant',
    content: 'Calling add',
    reasoning_content: 'I should use the addition tool',
    tool_calls: [
      {
        id: 'call-1',
        type: 'function',
        function: {name: 'add', arguments: '{"a":2,"b":3}'},
      },
    ],
  }
  const modelEnd = f.emit(
    'model.end',
    {
      id: 'round-1',
      message,
      finishReason: 'tool_calls',
      usage: {prompt_tokens: 11, completion_tokens: 7},
    },
    turn,
  )
  f.emit('message', message, turn)
  f.emit(
    'tool.start',
    {id: 'call-1', span: 'tool-1', name: 'add', arguments: '{"a":2,"b":3}'},
    turn,
  )
  f.emit(
    'action.before',
    {kind: 'tool', title: 'Add numbers'},
    {...turn, span: 'tool-1'},
  )
  f.emit(
    'activity.start',
    {id: 'ability-1', kind: 'ability', name: 'add', input: [2, 3]},
    {...turn, span: 'ability-1', parentSpan: 'tool-1'},
  )
  f.emit(
    'thread.created',
    {
      kind: 'code',
      parent: 'root',
      parentInvocation: 'turn-1',
      parentSpan: 'ability-1',
    },
    {thread: 'child'},
  )
  f.emit(
    'thread.state',
    {state: 'running', invocation: 'child-turn'},
    {thread: 'child', invocation: 'child-turn'},
  )
  f.emit('result', 5, {thread: 'child', invocation: 'child-turn'})
  f.emit(
    'thread.state',
    {state: 'dead', invocation: 'child-turn'},
    {thread: 'child', invocation: 'child-turn'},
  )
  f.emit(
    'activity.end',
    {id: 'ability-1', kind: 'ability', output: 5},
    {...turn, span: 'ability-1', parentSpan: 'tool-1'},
  )
  f.emit(
    'tool.end',
    {id: 'call-1', span: 'tool-1', name: 'add', result: 5},
    turn,
  )
  f.emit('message', {role: 'tool', tool_call_id: 'call-1', content: '5'}, turn)
  f.emit(
    'model.start',
    {
      id: 'round-2',
      step: 1,
      identity,
      request: {
        ...request,
        messages: [
          ...request.messages,
          message,
          {role: 'tool', tool_call_id: 'call-1', content: '5'},
        ],
      },
    },
    turn,
  )
  f.emit(
    'model.end',
    {
      id: 'round-2',
      message: {role: 'assistant', content: 'The sum is 5'},
      finishReason: 'stop',
      usage: {prompt_tokens: 20, completion_tokens: 4},
    },
    turn,
  )
  f.emit('message', {role: 'assistant', content: 'The sum is 5'}, turn)
  const idle = f.emit(
    'thread.state',
    {state: 'idle', invocation: turn.invocation},
    turn,
  )
  const dead = f.emit(
    'thread.state',
    {state: 'dead', invocation: turn.invocation},
    turn,
  )
  await f.observer.flush()

  const root = f.find((r) => r.name === 'msh.thread root')
  const invocation = f.find(
    (r) => r.name === 'msh.turn' && r.extra?.metadata.invocation === 'turn-1',
  )
  const first = f.find((r) => r.extra?.metadata.model_call === 'round-1')
  const second = f.find((r) => r.extra?.metadata.model_call === 'round-2')
  const tool = f.find((r) => r.run_type === 'tool')
  const activity = f.find((r) => r.extra?.metadata.kind === 'ability')
  const child = f.find((r) => r.name === 'msh.thread child')
  expect(f.all()).toHaveLength(8)
  expect(f.all().filter((r) => !r.parent_run_id)).toHaveLength(1)
  expect(invocation.parent_run_id).toBe(root.id)
  expect(first.parent_run_id).toBe(invocation.id)
  expect(second.parent_run_id).toBe(invocation.id)
  expect(tool.parent_run_id).toBe(invocation.id)
  expect(activity.parent_run_id).toBe(tool.id)
  expect(child.parent_run_id).toBe(activity.id)
  for (const run of f.all()) {
    expect(run.trace_id).toBe(root.id)
    expect(run.dotted_order?.startsWith(root.dotted_order ?? 'missing')).toBe(
      true,
    )
    expect(run.session_name).toBe('msh-test')
    expect(run.child_runs).toEqual([])
  }
  expect(new Date(root.start_time ?? 0).getTime()).toBe(
    Date.parse(created.time),
  )
  expect(root.end_time).toBe(Date.parse(dead.time))
  expect(invocation.end_time).toBe(Date.parse(idle.time))
  expect(new Date(first.start_time ?? 0).getTime()).toBe(
    Date.parse(modelStart.time),
  )
  expect(first.end_time).toBe(Date.parse(modelEnd.time))
  expect(first.inputs).toEqual(request)
  expect(first.outputs?.choices[0].message).toEqual(message)
  expect(first.outputs?.usage_metadata).toEqual({
    input_tokens: 11,
    output_tokens: 7,
    total_tokens: 18,
  })
  expect(first.extra?.metadata).toMatchObject({
    ls_provider: 'fixture',
    ls_model_name: 'fixture-model',
    ls_model_type: 'chat',
    ls_max_tokens: 256,
    purpose: 'turn',
  })
  expect(first.events?.find((e) => e.name === 'stream')).toMatchObject({
    time: token.time,
    kwargs: {token: 'Calling add', seq: token.seq},
  })
  expect(tool.inputs).toEqual({arguments: {a: 2, b: 3}})
  expect(tool.outputs).toEqual({output: 5})
  expect(tool.events?.map((e) => e.name)).toEqual([
    'tool.start',
    'action.before',
    'tool.end',
  ])
  expect(child.outputs?.result).toBe(5)
  expect(root.inputs.messages).toEqual(request.messages)
  expect(invocation.outputs?.messages.at(-1).content).toBe('The sum is 5')
  expect(root.outputs?.messages.at(-1).content).toBe('The sum is 5')
})

test('flush persists active streaming spans without ending them and snapshots each queued payload', async () => {
  const f = fixture()
  f.emit('thread.created', {kind: 'llm'})
  const turn = {invocation: 'live-turn'}
  f.emit('thread.state', {state: 'running'}, turn)
  f.emit('model.start', {id: 'live-model', identity, request}, turn)
  f.emit('stream', {id: 'live-model', text: 'First'}, turn)
  await f.observer.flush()
  const active = f.find((r) => r.run_type === 'llm')
  expect(active.end_time).toBeUndefined()
  expect(active.outputs).toEqual({partial_text: 'First'})
  expect(active.events?.filter((e) => e.name === 'new_token')).toHaveLength(1)
  f.emit('stream', {id: 'live-model', text: ' second'}, turn)
  expect(active.events?.filter((e) => e.name === 'new_token')).toHaveLength(1)
  f.emit(
    'model.end',
    {
      id: 'live-model',
      message: {role: 'assistant', content: 'First second'},
      finishReason: 'stop',
    },
    turn,
  )
  await f.observer.flush()
  expect(
    f
      .find((r) => r.run_type === 'llm')
      .events?.filter((e) => e.name === 'stream'),
  ).toHaveLength(2)
  expect(f.find((r) => r.name === 'msh.thread root').end_time).toBeUndefined()
  for (const run of f.all())
    expect(f.client.operations.filter((o) => o.id === run.id)[0]?.type).toBe(
      'create',
    )
})

test('completed invocations publish root conversation content while the interactive thread remains open', async () => {
  const f = fixture()
  const turn = {invocation: 'interactive-turn'}
  f.emit('thread.created', {kind: 'llm'})
  f.emit('invocation.start', {invocation: turn.invocation}, turn)
  f.emit('model.start', {id: 'interactive-model', identity, request}, turn)
  const message = {role: 'assistant', content: 'The sum is 5'}
  f.emit(
    'model.end',
    {id: 'interactive-model', message, finishReason: 'stop'},
    turn,
  )
  f.emit('message', message, turn)
  f.emit('invocation.end', {invocation: turn.invocation}, turn)
  await new Promise<void>((resolve) => setImmediate(resolve))
  const root = f.find((r) => r.name === 'msh.thread root')
  expect(root.inputs.messages).toEqual(request.messages)
  expect(root.outputs?.messages).toEqual([message])
  expect(root.end_time).toBeUndefined()
  expect(
    f.client.operations.some(
      (operation) => operation.type === 'update' && operation.id === root.id,
    ),
  ).toBe(true)
})

test('span identity separates reused tool call ids and preserves errors, transfers and cancelled rounds', async () => {
  const f = fixture()
  f.emit('thread.created', {kind: 'llm'})
  for (const [index, terminal] of [
    {error: 'Tool denied'},
    {transferred: true},
  ].entries()) {
    const turn = {invocation: `turn-${index}`}
    f.emit('thread.state', {state: 'running'}, turn)
    f.emit(
      'tool.start',
      {id: 'reused-call', span: `span-${index}`, name: 'exec', arguments: '{}'},
      turn,
    )
    f.emit(
      'tool.end',
      {
        id: 'reused-call',
        name: 'exec',
        skipped: true,
        error: 'Skipped pending call',
      },
      turn,
    )
    f.emit(
      'tool.end',
      {id: 'reused-call', span: `span-${index}`, name: 'exec', ...terminal},
      turn,
    )
    f.emit('thread.state', {state: 'idle'}, turn)
  }
  const cancelled = {invocation: 'cancelled-turn'}
  f.emit('thread.state', {state: 'running'}, cancelled)
  f.emit(
    'model.start',
    {
      id: 'cancelled-round',
      identity,
      request: {...request, purpose: 'compaction'},
    },
    cancelled,
  )
  f.emit('stream', {id: 'cancelled-round', text: 'Partial'}, cancelled)
  const failed = f.emit(
    'model.error',
    {
      id: 'cancelled-round',
      error: 'Aborted',
      cancelled: true,
      partialText: 'Partial',
    },
    cancelled,
  )
  f.emit('interrupted', {}, cancelled)
  f.emit('thread.state', {state: 'idle'}, cancelled)
  f.emit('thread.state', {state: 'dead'}, cancelled)
  await f.observer.flush()
  const tools = f.all().filter((r) => r.run_type === 'tool')
  expect(tools).toHaveLength(2)
  expect(tools[0]?.id).not.toBe(tools[1]?.id)
  expect(tools[0]?.parent_run_id).not.toBe(tools[1]?.parent_run_id)
  expect(tools[0]?.error).toBe('Tool denied')
  expect(tools[1]?.error).toBeUndefined()
  expect(tools[1]?.outputs).toEqual({transferred: true})
  expect(tools[1]?.extra?.metadata.status).toBe('transferred')
  const model = f.find((r) => r.run_type === 'llm')
  expect(model.end_time).toBe(Date.parse(failed.time))
  expect(model.error).toBe('Aborted')
  expect(model.outputs).toEqual({partial_text: 'Partial'})
  expect(model.extra?.metadata).toMatchObject({
    purpose: 'compaction',
    status: 'cancelled',
  })
  expect(f.all().every((r) => r.end_time !== undefined)).toBe(true)
})

test('thread termination closes unfinished activities and records their failure', async () => {
  const f = fixture()
  f.emit('thread.created', {kind: 'context'})
  const context = {invocation: 'evaluation-turn', span: 'evaluation'}
  f.emit('thread.state', {state: 'running'}, {invocation: context.invocation})
  f.emit(
    'activity.start',
    {
      id: 'evaluation',
      kind: 'evaluation',
      name: 'evaluate',
      input: {source: 'await wait()'},
    },
    context,
  )
  f.emit('error', {message: 'Evaluator failed'}, context)
  const dead = f.emit(
    'thread.state',
    {state: 'dead'},
    {invocation: context.invocation},
  )
  await f.observer.flush()
  const evaluation = f.find((r) => r.name === 'evaluate')
  expect(evaluation.inputs).toEqual({arguments: {source: 'await wait()'}})
  expect(evaluation.error).toBe('Evaluator failed')
  expect(f.all().every((r) => r.end_time !== undefined)).toBe(true)
  expect(f.find((r) => r.name === 'msh.thread root').end_time).toBe(
    Date.parse(dead.time),
  )
})

test('transport failures are reported by flush while event routing remains synchronous', async () => {
  for (const failure of ['create', 'update', 'flush'] as const) {
    const f = fixture()
    f.client.failure = failure
    expect(() => f.emit('thread.created', {kind: 'llm'})).not.toThrow()
    expect(() => f.emit('thread.state', {state: 'dead'})).not.toThrow()
    await expect(f.observer.flush()).rejects.toThrow(`${failure} failed`)
  }
})

test('cleanup failures mark the completed thread failed and preserve successful child spans', async () => {
  const f = fixture()
  const turn = {invocation: 'cleanup-turn'}
  f.emit('thread.created', {kind: 'llm'})
  f.emit('invocation.start', {invocation: turn.invocation}, turn)
  f.emit('model.start', {id: 'cleanup-model', identity, request}, turn)
  f.emit(
    'model.end',
    {
      id: 'cleanup-model',
      message: {role: 'assistant', content: 'Finished'},
      finishReason: 'stop',
    },
    turn,
  )
  f.emit('message', {role: 'assistant', content: 'Finished'}, turn)
  f.emit(
    'tool.start',
    {id: 'cleanup-call', span: 'cleanup-tool', name: 'save', arguments: '{}'},
    turn,
  )
  f.emit(
    'tool.end',
    {id: 'cleanup-call', span: 'cleanup-tool', result: 'saved'},
    turn,
  )
  f.emit('invocation.end', {invocation: turn.invocation}, turn)
  const dead = f.emit('thread.state', {state: 'dead'}, turn)
  await f.observer.flush()
  const before = f.all()
  const root = f.find((r) => r.name === 'msh.thread root')
  const cleanup = f.emit(
    'cleanup.error',
    {
      message: 'Extension cleanup failed',
      causes: ['Socket close failed', 'Worker disposal failed'],
    },
    {...turn, span: 'cleanup-tool'},
  )
  await f.observer.flush()
  const failed = f.find((r) => r.id === root.id)
  expect(f.all()).toHaveLength(before.length)
  expect(failed.error).toBe('Extension cleanup failed')
  expect(failed.extra?.metadata.status).toBe('error')
  expect(failed.end_time).toBe(Date.parse(dead.time))
  expect(failed.outputs).toEqual(root.outputs)
  expect(failed.events?.at(-1)).toMatchObject({
    name: 'cleanup.error',
    time: cleanup.time,
    kwargs: {
      data: {
        message: 'Extension cleanup failed',
        causes: ['Socket close failed', 'Worker disposal failed'],
      },
    },
  })
  for (const previous of before.filter((r) => r.id !== root.id))
    expect(f.find((r) => r.id === previous.id)).toEqual(previous)
})

test('concurrent invocations end independently and late cancelled completion retains partial text', async () => {
  const f = fixture()
  f.emit('thread.created', {kind: 'context'})
  const first = {invocation: 'first'}
  const second = {invocation: 'second'}
  f.emit(
    'invocation.start',
    {invocation: first.invocation, kind: 'managed'},
    first,
  )
  f.emit(
    'activity.start',
    {id: 'first-activity', name: 'first', input: 'slow'},
    {...first, span: 'first-activity'},
  )
  f.emit(
    'invocation.start',
    {invocation: second.invocation, kind: 'managed'},
    second,
  )
  f.emit('model.start', {id: 'second-model', identity, request}, second)
  f.emit(
    'activity.end',
    {id: 'first-activity', output: 'finished'},
    {...first, span: 'first-activity'},
  )
  const firstEnd = f.emit(
    'invocation.end',
    {invocation: first.invocation},
    first,
  )
  await f.observer.flush()
  expect(
    f.find(
      (r) =>
        r.name === 'msh.turn' &&
        r.extra?.metadata.invocation === first.invocation,
    ).end_time,
  ).toBe(Date.parse(firstEnd.time))
  expect(f.find((r) => r.run_type === 'llm').end_time).toBeUndefined()
  f.emit('stream', {id: 'second-model', text: 'Halfway'}, second)
  const interrupted = f.emit('interrupted', {}, second)
  f.emit(
    'model.error',
    {
      id: 'second-model',
      partialText: 'Halfway',
      error: 'AbortError',
      cancelled: true,
    },
    second,
  )
  f.emit(
    'invocation.end',
    {invocation: second.invocation, error: 'AbortError', cancelled: true},
    second,
  )
  f.emit('thread.state', {state: 'idle'}, second)
  await f.observer.flush()
  const model = f.find((r) => r.run_type === 'llm')
  expect(model.end_time).toBe(Date.parse(interrupted.time))
  expect(model.outputs).toEqual({partial_text: 'Halfway'})
  expect(model.error).toBe('AbortError')
  expect(model.extra?.metadata.status).toBe('cancelled')
  expect(f.find((r) => r.name === 'msh.thread root').end_time).toBeUndefined()
})

test('the pinned SDK sends usable trace JSON and propagates HTTP rejection', async () => {
  const requests: {method: string; path: string; body: RunCreate}[] = []
  let reject = false
  const fetchImplementation = (async (input, init) => {
    const request = new Request(input, init)
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: (await request.json()) as RunCreate,
    })
    return new Response(reject ? '{"detail":"trace unavailable"}' : '{}', {
      status: reject ? 401 : 200,
      headers: {'content-type': 'application/json'},
    })
  }) as typeof fetch
  const client = new Client({
    apiUrl: 'https://traces.test',
    apiKey: 'test',
    autoBatchTracing: false,
    callerOptions: {maxRetries: 0},
    fetchImplementation,
  })
  const observer = langsmith({enabled: true, client, project: 'wire-test'})
  if (!observer) throw new Error('tracing is disabled')
  let seq = 0
  const emit = (type: string, data: unknown, invocation?: string) =>
    observer.event({
      thread: 'wire-root',
      type,
      data,
      seq: ++seq,
      time: new Date(Date.UTC(2026, 9, 3, 1, 0, seq)).toISOString(),
      ...(invocation ? {invocation} : {}),
    })
  emit('thread.created', {kind: 'llm'})
  emit('invocation.start', {invocation: 'wire-turn'}, 'wire-turn')
  emit('model.start', {id: 'wire-model', identity, request}, 'wire-turn')
  emit('stream', {id: 'wire-model', text: 'Five'}, 'wire-turn')
  await observer.flush()
  expect(
    requests
      .filter((r) => r.method === 'PATCH' && r.body.run_type === 'llm')
      .at(-1)?.body.outputs,
  ).toEqual({partial_text: 'Five'})
  emit(
    'model.end',
    {
      id: 'wire-model',
      message: {
        role: 'assistant',
        content: 'Five',
        reasoning_content: 'Two plus three',
      },
      usage: {prompt_tokens: 9, completion_tokens: 3},
      finishReason: 'stop',
    },
    'wire-turn',
  )
  emit('invocation.end', {invocation: 'wire-turn'}, 'wire-turn')
  emit('thread.state', {state: 'dead'})
  await observer.flush()
  const creations = requests.filter((r) => r.method === 'POST')
  expect(creations).toHaveLength(3)
  expect(creations.every((r) => r.path === '/runs')).toBe(true)
  const root = creations.find(
    (r) => r.body.name === 'msh.thread wire-root',
  )?.body
  const turn = creations.find((r) => r.body.name === 'msh.turn')?.body
  const model = creations.find((r) => r.body.run_type === 'llm')?.body
  expect(model?.inputs).toEqual(request)
  expect(model?.parent_run_id).toBe(turn?.id)
  expect(turn?.parent_run_id).toBe(root?.id)
  expect(model?.trace_id).toBe(root?.id)
  const completion = requests
    .filter((r) => r.method === 'PATCH' && r.path === `/runs/${model?.id}`)
    .at(-1)?.body
  expect(completion?.outputs?.choices[0].message).toMatchObject({
    content: 'Five',
    reasoning_content: 'Two plus three',
  })
  expect(completion?.outputs?.usage_metadata).toEqual({
    input_tokens: 9,
    output_tokens: 3,
    total_tokens: 12,
  })
  expect(completion?.events?.find((e) => e.name === 'new_token')?.time).toBe(
    '2026-10-03T01:00:04.000Z',
  )
  expect(
    completion?.events?.find((e) => e.name === 'stream')?.kwargs.token,
  ).toBe('Five')
  expect(completion?.end_time).toBeDefined()
  expect(completion?.extra?.metadata.status).toBe('success')
  reject = true
  emit('thread.created', {kind: 'context'})
  await expect(observer.flush()).rejects.toThrow('401')
})
