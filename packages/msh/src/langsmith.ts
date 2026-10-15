import {Client} from 'langsmith/client'
import {RunTree} from 'langsmith/run_trees'
import type {Message, Observer, RuntimeEvent} from './types.ts'

export interface LangSmithOptions {
  enabled?: boolean
  project?: string
  client?: Client
}

type Fields = Record<string, unknown>
interface Span {
  run: RunTree
  thread: string
  invocation?: string
  kind: 'thread' | 'turn' | 'model' | 'tool' | 'activity'
  pending: Promise<void>
  messages: Message[]
}
interface ThreadTrace {
  span: Span
  turns: Map<string, Span>
  active?: Span
}
const fields = (value: unknown): Fields =>
  value !== null && typeof value === 'object' ? (value as Fields) : {}
const string = (value: unknown) =>
  typeof value === 'string' ? value : undefined
const timestamp = (event: RuntimeEvent) => Date.parse(event.time)
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function langsmith(
  options: LangSmithOptions = {},
): Observer | undefined {
  if (
    !(
      options.enabled ?? process.env.LANGSMITH_TRACING?.toLowerCase() === 'true'
    )
  )
    return undefined
  if (!options.client && !process.env.LANGSMITH_API_KEY)
    throw new Error('LANGSMITH_TRACING requires LANGSMITH_API_KEY')
  const client =
    options.client ??
    new Client({
      timeout_ms: 5000,
      callerOptions: {maxRetries: 0},
      autoBatchTracing: false,
    })
  const project = options.project ?? process.env.LANGSMITH_PROJECT ?? 'msh'
  const threads = new Map<string, ThreadTrace>()
  const spans = new Map<string, Span>()
  const dirty = new Set<Span>()
  const pending = new Set<Promise<void>>()
  const failures: unknown[] = []

  const queue = (span: Span, operation: () => Promise<void>) => {
    const task = span.pending.then(operation).catch((error: unknown) => {
      failures.push(error)
    })
    span.pending = task
    pending.add(task)
    void task.finally(() => pending.delete(task))
  }
  const snapshot = (span: Span) => copy({...span.run.toJSON(), child_runs: []})
  const patch = (span: Span) => {
    dirty.delete(span)
    const {child_runs: _, ...update} = snapshot(span)
    // RunTree.patchRun catches transport errors; the client preserves rejection.
    queue(span, () => client.updateRun(span.run.id, update))
  }
  const create = (
    event: RuntimeEvent,
    kind: Span['kind'],
    name: string,
    inputs: Fields,
    parent?: Span,
    metadata: Fields = {},
  ): Span => {
    const config = {
      name,
      run_type: kind === 'model' ? 'llm' : kind === 'tool' ? 'tool' : 'chain',
      client,
      project_name: project,
      start_time: timestamp(event),
      inputs,
      metadata: {
        thread_id: event.thread,
        ...(event.invocation ? {invocation: event.invocation} : {}),
        ...metadata,
      },
      tags: ['msh', kind],
    }
    const run = parent ? parent.run.createChild(config) : new RunTree(config)
    if (parent) parent.run.child_runs = []
    const span: Span = {
      run,
      thread: event.thread,
      ...(event.invocation ? {invocation: event.invocation} : {}),
      kind,
      pending: parent?.pending ?? Promise.resolve(),
      messages: [],
    }
    const payload = snapshot(span)
    queue(span, () => client.createRun(payload))
    return span
  }
  const addEvent = (span: Span, event: RuntimeEvent, name = event.type) => {
    span.run.addEvent({
      name,
      time: event.time,
      kwargs: {
        seq: event.seq,
        type: event.type,
        ...(event.invocation ? {invocation: event.invocation} : {}),
        ...(event.span ? {span: event.span} : {}),
        data: event.data,
        ...(event.type === 'stream' ? {token: fields(event.data).text} : {}),
      },
    })
    dirty.add(span)
  }
  const end = (
    span: Span,
    event: RuntimeEvent,
    outputs: Fields = span.run.outputs ?? {},
    error?: string,
    status = error ? 'error' : 'success',
    terminal = false,
  ) => {
    if (span.run.end_time !== undefined && !terminal) return
    span.run.outputs = outputs
    span.run.end_time ??= timestamp(event)
    if (error !== undefined) span.run.error = error
    else if (terminal) delete span.run.error
    span.run.metadata = {...span.run.metadata, status}
    patch(span)
  }
  const getThread = (event: RuntimeEvent): ThreadTrace => {
    const existing = threads.get(event.thread)
    if (existing) return existing
    const data = fields(event.data)
    const parentThread = threads.get(string(data.parent) ?? '')
    const parent =
      spans.get(string(data.parentSpan) ?? '') ??
      parentThread?.turns.get(string(data.parentInvocation) ?? '') ??
      parentThread?.active ??
      parentThread?.span
    const span = create(
      event,
      'thread',
      `msh.thread ${event.thread}`,
      {},
      parent,
      {
        kind: data.kind,
        cwd: data.cwd,
        parent_thread: data.parent,
      },
    )
    const thread: ThreadTrace = {span, turns: new Map()}
    threads.set(event.thread, thread)
    return thread
  }
  const getTurn = (thread: ThreadTrace, event: RuntimeEvent) => {
    const invocation = event.invocation ?? string(fields(event.data).invocation)
    if (!invocation) return thread.active
    let turn = thread.turns.get(invocation)
    if (!turn) {
      turn = create(event, 'turn', 'msh.turn', {}, thread.span, {invocation})
      turn.invocation = invocation
      thread.turns.set(invocation, turn)
    }
    if (turn.run.end_time === undefined) thread.active = turn
    return turn
  }
  const parentFor = (
    event: RuntimeEvent,
    turn: Span | undefined,
    thread: ThreadTrace,
    id?: string,
  ) =>
    spans.get((event.span === id ? event.parentSpan : event.span) ?? '') ??
    turn ??
    thread.span

  const record = (event: RuntimeEvent) => {
    const data = fields(event.data)
    const thread = getThread(event)
    const turn =
      event.type === 'thread.created' || event.type === 'cleanup.error'
        ? undefined
        : getTurn(thread, event)
    const id = string(data.span) ?? string(data.id)
    let target =
      event.type === 'cleanup.error'
        ? thread.span
        : parentFor(event, turn, thread)

    if (event.type === 'model.start') {
      const request = fields(data.request)
      const identity = fields(data.identity)
      const metadata = {
        model_call: id,
        step: data.step,
        purpose: data.purpose ?? request.purpose,
        ls_provider: identity.provider,
        ls_model_name: identity.model,
        ls_model_type: 'chat',
        ...(request.maxOutputTokens !== undefined
          ? {ls_max_tokens: request.maxOutputTokens}
          : {}),
      }
      target = create(
        event,
        'model',
        `msh.model ${string(identity.model) ?? 'completion'}`,
        request,
        parentFor(event, turn, thread, id),
        metadata,
      )
      if (id) spans.set(id, target)
      for (const chain of [thread.span, turn]) {
        if (!chain || chain.run.inputs.messages !== undefined) continue
        chain.run.inputs = {...chain.run.inputs, messages: request.messages}
        dirty.add(chain)
      }
    } else if (event.type === 'tool.start' || event.type === 'activity.start') {
      let input = data.input
      if (event.type === 'tool.start') {
        input = data.arguments
        if (typeof input === 'string') {
          try {
            input = JSON.parse(input)
          } catch {}
        }
      }
      target = create(
        event,
        event.type === 'tool.start' ? 'tool' : 'activity',
        string(data.name) ?? event.type,
        {arguments: input},
        parentFor(event, turn, thread, id),
        {call_id: data.id, kind: data.kind},
      )
      if (id) spans.set(id, target)
    } else if (
      event.type === 'model.end' ||
      event.type === 'model.error' ||
      event.type === 'tool.end' ||
      event.type === 'activity.end' ||
      event.type === 'stream'
    ) {
      target = (id ? spans.get(id) : undefined) ?? target
    }

    addEvent(target, event)

    if (event.type === 'cleanup.error') {
      thread.span.run.error = string(data.message) ?? 'Thread cleanup failed'
      thread.span.run.metadata = {...thread.span.run.metadata, status: 'error'}
    } else if (event.type === 'stream' && target.kind === 'model') {
      if (target.run.outputs?.partial_text === undefined)
        target.run.addEvent({name: 'new_token', time: event.time})
      target.run.outputs = {
        partial_text: `${target.run.outputs?.partial_text ?? ''}${string(data.text) ?? ''}`,
      }
    } else if (event.type === 'model.end' && target.kind === 'model') {
      const usage = fields(data.usage)
      const input =
        typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
      const output =
        typeof usage.completion_tokens === 'number'
          ? usage.completion_tokens
          : 0
      end(
        target,
        event,
        {
          choices: [
            {index: 0, message: data.message, finish_reason: data.finishReason},
          ],
          ...(data.usage
            ? {
                usage_metadata: {
                  input_tokens: input,
                  output_tokens: output,
                  total_tokens: input + output,
                },
              }
            : {}),
        },
        undefined,
        'success',
        true,
      )
    } else if (event.type === 'model.error' && target.kind === 'model') {
      end(
        target,
        event,
        {partial_text: data.partialText},
        string(data.error) ?? 'Model request failed',
        data.cancelled ? 'cancelled' : 'error',
        true,
      )
    } else if (
      (event.type === 'tool.end' && target.kind === 'tool' && !data.skipped) ||
      (event.type === 'activity.end' && target.kind === 'activity')
    ) {
      end(
        target,
        event,
        {
          output: event.type === 'tool.end' ? data.result : data.output,
          ...(data.transferred ? {transferred: true} : {}),
        },
        string(data.error),
        data.cancelled
          ? 'cancelled'
          : data.transferred
            ? 'transferred'
            : data.error
              ? 'error'
              : 'success',
        true,
      )
    } else if (event.type === 'message') {
      for (const chain of [thread.span, turn]) {
        if (!chain) continue
        chain.messages.push(data as unknown as Message)
        chain.run.outputs = {messages: chain.messages}
        dirty.add(chain)
      }
    } else if (event.type === 'result') {
      for (const chain of [thread.span, turn]) {
        if (!chain) continue
        chain.run.outputs = {...chain.run.outputs, result: event.data}
        dirty.add(chain)
      }
    } else if (event.type === 'error' || event.type === 'interrupted') {
      const error =
        string(data.message) ??
        (event.type === 'interrupted' ? 'Interrupted' : 'Thread failed')
      for (const span of spans.values())
        if (
          span.thread === event.thread &&
          (event.type === 'interrupted' ||
            !turn ||
            span.invocation === turn.invocation)
        )
          end(
            span,
            event,
            span.run.outputs,
            error,
            event.type === 'interrupted' ? 'cancelled' : 'error',
          )
      for (const active of thread.turns.values())
        if (
          active.run.end_time === undefined &&
          (event.type === 'interrupted' || active === turn)
        ) {
          active.run.error = error
          active.run.metadata = {
            ...active.run.metadata,
            status: event.type === 'interrupted' ? 'cancelled' : 'error',
          }
          dirty.add(active)
        }
      thread.span.run.error = error
      dirty.add(thread.span)
    } else if (event.type === 'invocation.end' && turn) {
      const error = string(data.error) ?? turn.run.error
      if (error) {
        thread.span.run.error = error
        dirty.add(thread.span)
      }
      const status = data.cancelled
        ? 'cancelled'
        : data.transferred
          ? 'transferred'
          : error
            ? 'error'
            : 'success'
      for (const span of spans.values())
        if (span.thread === event.thread && span.invocation === turn.invocation)
          end(
            span,
            event,
            span.run.outputs,
            error ??
              (data.transferred
                ? undefined
                : 'Invocation ended before the operation completed'),
            data.transferred ? 'transferred' : 'cancelled',
          )
      end(turn, event, turn.run.outputs, error, status)
      patch(thread.span)
      if (thread.active === turn) delete thread.active
    } else if (
      event.type === 'thread.state' &&
      (data.state === 'idle' || data.state === 'dead')
    ) {
      for (const span of spans.values())
        if (span.thread === event.thread && span.run.end_time === undefined)
          end(
            span,
            event,
            span.run.outputs,
            'Thread ended before the operation completed',
            'cancelled',
          )
      for (const other of thread.turns.values())
        end(
          other,
          event,
          other.run.outputs,
          other.run.error,
          string(other.run.metadata.status),
        )
      delete thread.active
      if (data.state === 'dead') {
        end(thread.span, event, thread.span.run.outputs, thread.span.run.error)
      }
    }
  }

  return {
    event(event) {
      try {
        record(event)
      } catch (error) {
        failures.push(error)
      }
    },
    async flush() {
      do {
        for (const span of dirty) patch(span)
        await Promise.all([...pending])
      } while (pending.size || dirty.size)
      await client.awaitPendingTraceBatches()
      if (failures.length) throw failures[0]
    },
  }
}
