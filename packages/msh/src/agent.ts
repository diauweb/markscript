import {registeredModuleSources} from '@markscript/compiler'
import type {Root} from 'mdast'
import {ApprovalDenied} from './approval.ts'
import {
  ContextTransfer,
  cancellable,
  errorMessage,
  useContext,
} from './context.ts'
import {
  conversation,
  emission,
  parseConversation,
  validateConversation,
} from './conversation.ts'
import type {
  ContextPreparation,
  ContextRecord,
  WaitResult as CoreWaitResult,
  Delivery,
  Evaluation,
  Handle,
  Prepared,
  Recipient,
  Target,
  ThreadContext,
} from './core-types.ts'
import {defineExtension, type ExtensionScope} from './extensions.ts'
import type {Harness} from './host.ts'
import {serialize} from './modules.ts'
import {callTool, coreTools, protocol} from './protocol.ts'
import {type InferredTool, inferTools} from './tools.ts'
import type {
  AgentSnapshot,
  Completion,
  HistoryMessage,
  Message,
  ModelRequest,
  Provider,
  ToolCall,
  ToolDefinition,
} from './types.ts'

interface Ability extends InferredTool {
  module: string
}
interface AgentThread {
  id: Handle
  purpose: ModelRequest['purpose']
  provider?: Provider
  nativeTools: ToolDefinition[]
  instructions: ContextRecord[]
  history: HistoryMessage[]
  active: Message[]
  abilities: Map<string, Ability>
  readonly cwd: string
  readonly revision: number
}
export interface AgentOptions {
  provider?: Provider
  contextBudget?: number
  maxOutputTokens?: number
  maxTurns?: number
}
export function agent(
  options: AgentOptions | ((scope: ExtensionScope) => AgentOptions) = {},
) {
  return defineExtension('msh.agent', (scope) => {
    scope.provide(
      'msh.agent',
      new Agent(
        scope,
        typeof options === 'function' ? options(scope) : options,
      ),
    )
  })
}
export class Agent {
  readonly host: Harness
  private readonly threads = new Map<Handle, AgentThread>()
  private readonly schemas = new Map<string, InferredTool[]>()
  constructor(
    readonly scope: ExtensionScope,
    readonly options: AgentOptions,
  ) {
    this.host = scope.host
    const validateExports = async ({module}: Evaluation) => {
      const c = useContext()
      if (
        !module.endsWith('.ms') ||
        (c.registration?.get<Agent>('msh.agent') ??
          this.host.service<Agent>('msh.agent', c.thread)) !== this
      )
        return
      await this.tools(module)
    }
    scope.hook<Evaluation>('evaluate.before', validateExports)
    scope.hook<Evaluation>('evaluate.ready', validateExports)
    scope.hook<ContextPreparation>('context.prepare', async (draft) => {
      if (draft.scope.get<Agent>('msh.agent') !== this) return
      const messages = draft.messages.flatMap((r) => parseConversation(r.text))
      validateConversation(messages)
      const abilities = await this.infer(draft.prepared)
      const t = this.get(draft.thread)
      const previous = this.host.service<Agent>('msh.agent', draft.thread)
      const retained =
        previous && previous !== this
          ? previous.inspect(draft.thread, 0)
          : undefined
      const tools = structuredClone([
        ...coreTools,
        callTool,
        ...[...abilities.values()]
          .filter((a) => a.exportName !== 'call')
          .map((a) => a.definition),
      ])
      draft.scope.onCommit(() => {
        if (retained) {
          t.history = retained.messages
          t.active = retained.context.messages.flatMap(parseConversation)
        }
        this.completePendingCalls(
          t,
          'Context replaced; remaining old calls were skipped',
        )
        t.instructions = draft.prepared.records
        t.abilities = abilities
        t.nativeTools = tools
        t.active = []
        for (const message of messages) this.message(t, message)
      })
    })
    scope.hook<{thread: Handle; prepared: Prepared; scope: ExtensionScope}>(
      'context.append',
      async (draft) => {
        if (draft.scope.get<Agent>('msh.agent') !== this) return
        const adopting = !this.host.service<Agent>('msh.agent', draft.thread)
        const t = this.get(draft.thread)
        const abilities = await this.infer(
          adopting
            ? {
                ...draft.prepared,
                bindings: new Map([
                  ...this.host.bindings(draft.thread),
                  ...draft.prepared.bindings,
                ]),
              }
            : draft.prepared,
        )
        for (const [name, ability] of abilities) {
          const native =
            name === 'call'
              ? undefined
              : t.nativeTools.find((tool) => tool.function.name === name)
          if (
            native &&
            serialize(native.function.parameters) !==
              serialize(ability.definition.function.parameters)
          )
            throw new Error(
              `Native argument schema is fixed for ${name}; use a new name or exec to change it`,
            )
        }
        draft.scope.onCommit(() => {
          for (const [name, ability] of abilities)
            t.abilities.set(name, ability)
          if (adopting) {
            t.instructions.push(...draft.prepared.records)
            t.nativeTools = structuredClone([
              ...coreTools,
              callTool,
              ...[...abilities.values()]
                .filter((a) => a.exportName !== 'call')
                .map((a) => a.definition),
            ])
          }
        })
      },
    )
    scope.hook<{thread: Handle}>('input', ({thread}) =>
      this.host.service<Agent>('msh.agent', thread) === this
        ? this.loop(this.get(thread))
        : undefined,
    )
    scope.hook<{thread: Handle; records: ContextRecord[]}>(
      'messages.before',
      ({thread, records}) => {
        if (this.host.service<Agent>('msh.agent', thread) !== this) return
        validateConversation(records.flatMap((r) => parseConversation(r.text)))
      },
    )
    scope.hook<{thread: Handle; records: ContextRecord[]; active: boolean}>(
      'messages.commit',
      ({thread, records, active}) => {
        if (this.host.service<Agent>('msh.agent', thread) !== this) return
        const t = this.get(thread)
        for (const message of records.flatMap((r) => parseConversation(r.text)))
          this.message(t, message, active)
      },
    )
    scope.on('context', (event) => {
      if (this.host.service<Agent>('msh.agent', event.thread) !== this) return
      const state = this.inspect(event.thread, 0)
      this.host.record(event.thread, 'agent.context', {
        generation: state.generation,
        instructions: state.context.instructions,
        messages: state.context.messages,
        nativeTools: state.nativeTools,
        abilities: state.abilities,
      })
    })
    scope.on('error', (event) => {
      const t = this.threads.get(event.thread)
      if (t)
        this.completePendingCalls(
          t,
          String((event.data as {message: string}).message),
        )
    })
    scope.on('interrupted', (event) => {
      const t = this.threads.get(event.thread)
      if (t) this.completePendingCalls(t, 'Interrupted')
    })
    scope.cleanup(() => {
      for (const thread of this.threads.keys())
        this.host.record(thread, 'agent.closed', this.inspect(thread, 0))
    })
  }
  private async tools(module: string): Promise<InferredTool[]> {
    let tools = this.schemas.get(module)
    if (!tools) {
      tools = await inferTools(module, registeredModuleSources())
      for (const tool of tools)
        if (coreTools.some((t) => t.function.name === tool.exportName))
          throw new Error(`Reserved primitive name: ${tool.exportName}`)
      this.schemas.set(module, tools)
    }
    return tools
  }
  private async infer(prepared: Prepared): Promise<Map<string, Ability>> {
    const abilities = new Map<string, Ability>()
    const modules = new Set(
      [...prepared.bindings.values()]
        .filter((b) => typeof b.value === 'function')
        .map((b) => b.module),
    )
    for (const module of modules)
      for (const tool of await this.tools(module)) {
        abilities.set(tool.exportName, {...tool, module})
      }
    return abilities
  }
  private get(id: Handle): AgentThread {
    let t = this.threads.get(id)
    if (!t) {
      const state = this.host.inspect(id)
      const parent = state.parent
      const inherited = parent
        ? this.host.service<Agent>('msh.agent', parent)?.provider(parent)
        : undefined
      const previous = this.host.service<Agent>('msh.agent', id)
      const snapshot =
        previous && previous !== this ? previous.inspect(id, 0) : undefined
      const prior = snapshot ? previous?.get(id) : undefined
      const provider = this.scope.thread
        ? (this.options.provider ?? inherited)
        : (inherited ?? this.options.provider)
      const host = this.host
      const records = host.events
        .filter((e) => e.thread === id && e.type === 'message')
        .map((e) => e.data as HistoryMessage)
      const active =
        snapshot?.context.messages.flatMap(parseConversation) ??
        state.context.messages.flatMap((r) => parseConversation(r.text))
      if (!snapshot) validateConversation(active)
      t = {
        id,
        purpose: prior?.purpose ?? 'turn',
        ...(provider ? {provider} : {}),
        nativeTools: snapshot?.nativeTools ?? [...coreTools, callTool],
        instructions: snapshot?.context.instructions ?? [
          ...state.context.instructions,
        ],
        history:
          snapshot?.messages ??
          (records.length
            ? records
            : state.history
                .flatMap((r) => parseConversation(r.text))
                .map((message, index) => ({
                  ...message,
                  document: conversation([message]),
                  id: index + 1,
                  time: new Date().toISOString(),
                }))),
        active,
        abilities: new Map(prior?.abilities),
        get cwd() {
          return host.inspect(id).cwd
        },
        get revision() {
          return host.inspect(id).generation
        },
      }
      this.threads.set(id, t)
    }
    return t
  }
  private message(
    t: AgentThread,
    message: Message,
    active = true,
    presentation: Pick<HistoryMessage, 'kind' | 'rendered'> = {},
  ): HistoryMessage {
    const m = {
      ...message,
      ...presentation,
      document: conversation([message]),
      id: t.history.length + 1,
      time: new Date().toISOString(),
    }
    t.history.push(m)
    if (active) t.active.push(message)
    this.host.record(t.id, 'message', m)
    return m
  }
  private currentMessage(
    t: AgentThread,
    message: Message,
    presentation: Pick<HistoryMessage, 'kind' | 'rendered'> = {},
  ): HistoryMessage {
    const selected = this.host.service<Agent>('msh.agent', t.id) ?? this
    return selected.message(selected.get(t.id), message, true, presentation)
  }
  private renderMessage(
    t: AgentThread,
    message: HistoryMessage,
    result: Pick<HistoryMessage, 'rendered' | 'renderError'>,
  ) {
    Object.assign(message, result)
    this.host.record(t.id, 'message.rendered', {id: message.id, ...result})
  }
  inspect(id = this.host.root, last_k_msg = 1): AgentSnapshot {
    if (!Number.isInteger(last_k_msg) || last_k_msg < 0)
      throw new Error('last_k_msg must be a nonnegative integer')
    const state = this.host.inspect(id)
    const archived =
      state.state === 'dead'
        ? ([...this.host.events]
            .reverse()
            .find((e) => e.thread === id && e.type === 'agent.closed')?.data as
            | AgentSnapshot
            | undefined)
        : undefined
    if (archived)
      return {
        ...archived,
        state: state.state,
        ...(state.error ? {error: state.error} : {}),
        ...(state.result === undefined ? {} : {result: state.result}),
        messages: last_k_msg
          ? archived.messages.slice(-last_k_msg)
          : archived.messages,
      }
    const t = this.get(id)
    return structuredClone({
      ...state,
      kind: state.kind === 'context' ? 'llm' : 'code',
      ...(t.provider?.identity ? {provider: t.provider.identity} : {}),
      messages: last_k_msg ? t.history.slice(-last_k_msg) : t.history,
      context: {
        instructions: t.instructions,
        messages: t.active.map((m) => conversation([m])),
      },
      conversation: conversation(t.history),
      nativeTools: t.nativeTools,
      abilities: [...t.abilities].map(([name, a]) => ({
        name,
        module: a.module,
        definition: a.definition,
      })),
      approvals: [],
    })
  }
  provider(id = this.host.root): Provider | undefined {
    return this.get(id).provider
  }
  setProvider(provider: Provider, id = this.host.root) {
    if (this.host.inspect(id).state !== 'idle')
      throw new Error('Choose a provider while the thread is idle')
    this.get(id).provider = provider
    this.host.record(id, 'provider', provider.identity ?? {})
  }
  async spawn(
    target: Target,
    parent = this.host.root,
    purpose: ModelRequest['purpose'] = 'turn',
  ) {
    const id = await this.host.spawn(target, parent)
    const selected = this.host.service<Agent>('msh.agent', id) ?? this
    selected.get(id).purpose = purpose
    return id
  }
  async wait(id?: Handle, caller?: Handle, signal?: AbortSignal) {
    const result: CoreWaitResult = await this.host.wait(id, caller, signal)
    return {
      ...result,
      messages:
        result.reason === 'settled'
          ? this.inspect(result.thread).messages
          : result.messages.flatMap((r) => parseConversation(r.text)),
    }
  }
  private async invoke(
    t: AgentThread,
    name: string,
    input: unknown,
  ): Promise<unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Tool arguments must be an object')
    const args = input as Record<string, unknown>
    if (!t.nativeTools.some((tool) => tool.function.name === name))
      throw new Error(
        `Unknown native tool: ${name}. Use call for exported abilities`,
      )
    switch (name) {
      case 'spawn':
        return this.spawn(args.target as Target, t.id)
      case 'send':
        return this.host.send(
          args.target as Recipient,
          args.message as Delivery,
          t.id,
        )
      case 'inspect':
        return this.inspect(
          args.handle === 'self' || args.handle === undefined
            ? t.id
            : String(args.handle),
          args.last_k_msg === undefined ? 1 : Number(args.last_k_msg),
        )
      case 'wait':
        return this.wait(
          args.handle === undefined ? undefined : String(args.handle),
          t.id,
          this.host.signal(t.id),
        )
      case 'exec':
        return this.host.replace(t.id, args as unknown as ThreadContext)
      case 'call': {
        if (
          typeof args.name !== 'string' ||
          Object.keys(args).some((key) => key !== 'name' && key !== 'arguments')
        )
          throw new Error('call requires {name: string, arguments: object}')
        const ability = t.abilities.get(args.name)
        if (!ability) throw new Error(`Unknown ability: ${args.name}`)
        return this.host.invoke(
          t.id,
          args.name,
          ability.arguments(args.arguments),
        )
      }
      default: {
        const ability = t.abilities.get(name)
        if (!ability) throw new Error(`Unknown ability: ${name}`)
        return this.host.invoke(t.id, name, ability.arguments(input))
      }
    }
  }
  private completePendingCalls(
    t: AgentThread,
    reason: string,
    except = new Set<string>(),
  ) {
    const pending = new Map<string, string>()
    for (const message of t.active) {
      for (const call of message.tool_calls ?? [])
        pending.set(call.id, call.function.name)
      if (message.tool_call_id) pending.delete(message.tool_call_id)
    }
    for (const [id, name] of pending) {
      if (except.has(id)) continue
      this.message(t, {
        role: 'tool',
        tool_call_id: id,
        content: serialize({error: reason}),
      })
      this.host.record(t.id, 'tool.end', {
        id,
        name,
        error: reason,
        skipped: true,
      })
    }
  }
  /** Adapter dispatch used by native calls and lowered tool-call fences. */
  async executeTool(id: Handle, call: ToolCall): Promise<void> {
    const selected = this.host.service<Agent>('msh.agent', id)
    if (selected && selected !== this) return selected.executeTool(id, call)
    const t = this.get(id)
    const signal = useContext().signal
    signal.throwIfAborted()
    const span = crypto.randomUUID()
    const {invocation, revision} = useContext()
    const historyStart = t.history.length
    const trace = {id: call.id, span, invocation, name: call.function.name}
    this.host.record(t.id, 'tool.start', {
      ...trace,
      arguments: call.function.arguments,
    })
    let result: unknown
    let denied: ApprovalDenied | undefined
    let failure: string | undefined
    try {
      result = await cancellable(
        this.host.execute(t.id, async (c) => {
          if (c.span) c.parentSpan = c.span
          else delete c.parentSpan
          c.span = span
          await this.host.authorize({
            kind: 'tool',
            title: `Call tool ${call.function.name}`,
            details: {
              name: call.function.name,
              arguments: JSON.parse(call.function.arguments),
            },
          })
          const value = await this.invoke(
            t,
            call.function.name,
            JSON.parse(call.function.arguments),
          )
          this.host.assertRevision(t.id, c.revision)
          return value
        }),
        signal,
      )
    } catch (error) {
      const generation = this.host.inspect(t.id).generation
      if (error instanceof ContextTransfer || generation !== revision) {
        this.host.record(t.id, 'tool.end', {
          ...trace,
          transferred: true,
          result: {generation},
        })
        throw new ContextTransfer()
      }
      if (error instanceof ApprovalDenied) denied = error
      failure = errorMessage(error)
      result = {error: failure}
    }
    if (!t.history.slice(historyStart).some((m) => m.tool_call_id === call.id))
      this.currentMessage(t, {
        role: 'tool',
        tool_call_id: call.id,
        content: serialize(result),
      })
    this.host.record(t.id, 'tool.end', {
      ...trace,
      result: JSON.parse(serialize(result)),
      ...(failure === undefined ? {} : {error: failure}),
      ...(signal.aborted ? {cancelled: true} : {}),
    })
    this.host.signal(t.id).throwIfAborted()
    if (denied) throw denied
  }
  private async loop(t: AgentThread): Promise<void> {
    const maxTurns = this.options.maxTurns ?? 32
    const invocation = useContext().invocation
    const used = this.host.events.filter(
      (e) =>
        e.thread === t.id &&
        e.type === 'model.start' &&
        (e.data as {invocation?: string}).invocation === invocation,
    ).length
    for (let step = used; step < maxTurns; step++) {
      useContext()
      if (this.host.service<Agent>('msh.agent', t.id) !== this)
        throw new ContextTransfer()
      await this.host.receive(t.id)
      if (!t.provider) throw new Error('A provider is required for LLM threads')
      const request: ModelRequest = {
        messages: [
          {
            role: 'system',
            content: `${protocol}\n${t.instructions.map((r) => r.text).join('\n')}\nWorking directory: ${t.cwd}\nCurrent thread: ${t.id}\n`,
          },
          ...t.active,
        ],
        tools: structuredClone(t.nativeTools),
        purpose: t.purpose,
        maxOutputTokens: this.options.maxOutputTokens ?? 8192,
      }
      if (
        this.options.contextBudget &&
        Buffer.byteLength(serialize(request)) > this.options.contextBudget
      )
        throw new Error(
          'Context budget exceeded. Compact this idle thread with /compact.',
        )
      const trace = {id: crypto.randomUUID(), invocation, step}
      const signal = useContext().signal
      this.host.record(t.id, 'model.start', {
        ...trace,
        identity: t.provider.identity,
        purpose: request.purpose,
        request,
      })
      let completion: Completion
      let partialText = ''
      let streaming = true
      try {
        completion = await cancellable(
          t.provider.complete(request, signal, (text) => {
            if (streaming && !signal.aborted) {
              partialText += text
              this.host.record(t.id, 'stream', {...trace, text})
            }
          }),
          signal,
        )
        useContext()
      } catch (error) {
        this.host.record(t.id, 'model.error', {
          ...trace,
          error: errorMessage(error),
          cancelled: signal.aborted,
          partialText,
        })
        throw error
      } finally {
        streaming = false
      }
      this.host.record(t.id, 'model.end', {
        ...trace,
        message: completion.message,
        usage: completion.usage,
        finishReason: completion.finishReason,
      })
      this.host.record(t.id, 'emission', completion.message)
      let output: ReturnType<typeof emission>
      try {
        if (completion.message.role !== 'assistant')
          throw new Error('Expected assistant output')
        output = emission(completion.message)
        validateConversation([
          ...t.active,
          output.message,
          ...(output.message.tool_calls ?? []).map(
            (call): Message => ({
              role: 'tool',
              tool_call_id: call.id,
              content: 'null',
            }),
          ),
        ])
      } catch (error) {
        const failed = this.currentMessage(t, {
          role: 'assistant',
          content: completion.message.content ?? '',
        })
        this.renderMessage(t, failed, {renderError: errorMessage(error)})
        this.currentMessage(
          t,
          {
            role: 'user',
            content: `MarkScript diagnostic: ${errorMessage(error)}`,
          },
          {kind: 'runtime'},
        )
        continue
      }
      const displayed = this.currentMessage(t, output.message)
      let acted = false
      let feedback: string | undefined
      let feedbackDocument: Root | undefined
      if (output.source) {
        try {
          await this.host.execute(t.id, async (c) => {
            const result = await this.host.evaluate(t.id, [output.source])
            this.renderMessage(t, displayed, {
              rendered: result.records[0]?.rendered ?? {
                type: 'root',
                children: [],
              },
            })
            acted = result.acted || c.actions > 0
            const observations = acted
              ? result.records.map((r) => r.text).join('\n') ||
                'MarkScript actions completed.'
              : ''
            const abilities = [...result.bindings.keys()]
              .flatMap(
                (name) =>
                  (this.host.service<Agent>('msh.agent', t.id) ?? this)
                    .get(t.id)
                    .abilities.get(name) ?? [],
              )
              .map((a) => ({
                name: a.exportName,
                module: a.module,
                definition: a.definition,
              }))
            feedback =
              [
                observations,
                abilities.length
                  ? `Exported abilities (invoke with native call or directly in MarkScript):\n${serialize(abilities)}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n\n') || undefined
            if (feedback) {
              feedbackDocument = {
                type: 'root',
                children: [
                  ...(acted
                    ? result.records.flatMap(
                        (record) => record.rendered?.children ?? [],
                      )
                    : []),
                ],
              }
              if (abilities.length)
                feedbackDocument.children.push(
                  {
                    type: 'heading',
                    depth: 3,
                    children: [{type: 'text', value: 'Exported abilities'}],
                  },
                  {
                    type: 'list',
                    ordered: false,
                    spread: false,
                    children: abilities.map((ability) => ({
                      type: 'listItem',
                      spread: false,
                      children: [
                        {
                          type: 'paragraph',
                          children: [
                            {type: 'inlineCode', value: ability.name},
                            {
                              type: 'text',
                              value: ability.definition.function.description
                                ? ` — ${ability.definition.function.description}`
                                : '',
                            },
                          ],
                        },
                      ],
                    })),
                  },
                )
            }
          })
        } catch (error) {
          this.renderMessage(t, displayed, {renderError: errorMessage(error)})
          if (
            error instanceof ContextTransfer ||
            error instanceof ApprovalDenied ||
            this.host.signal(t.id).aborted
          )
            throw error
          acted = true
          feedback = `MarkScript diagnostic: ${errorMessage(error)}`
          feedbackDocument = undefined
          // A failed document may have stopped before some embedded calls.
          const nativeIds = new Set(output.native.map((call) => call.id))
          this.completePendingCalls(
            t,
            'Document evaluation stopped before this action',
            nativeIds,
          )
        }
      }
      for (const call of output.native) await this.executeTool(t.id, call)
      if (feedback)
        this.currentMessage(
          t,
          {
            role: 'user',
            content: `Runtime feedback:\n${feedback}`,
          },
          {
            kind: 'runtime',
            ...(feedbackDocument ? {rendered: feedbackDocument} : {}),
          },
        )
      if (this.host.service<Agent>('msh.agent', t.id) !== this)
        throw new ContextTransfer()
      if (
        !acted &&
        !output.message.tool_calls?.length &&
        !this.host.inspect(t.id).pending
      )
        return
    }
    throw new Error(`Turn reached ${maxTurns} model requests`)
  }
}

export async function executeTool(call: ToolCall): Promise<void> {
  const c = useContext()
  const agent = c.host.service<Agent>('msh.agent', c.thread)
  if (!agent)
    throw new Error('The agent extension is required for tool-call fences')
  await agent.executeTool(c.thread, call)
}

export function inspect(
  handle: Handle | 'self' = 'self',
  last_k_msg = 1,
): AgentSnapshot {
  const c = useContext()
  c.actions++
  const agent = c.host.service<Agent>('msh.agent', c.thread)
  if (!agent) throw new Error('Agent inspection requires the agent extension')
  return agent.inspect(handle === 'self' ? c.thread : handle, last_k_msg)
}
