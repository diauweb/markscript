import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {toMarkdown} from 'mdast-util-to-markdown'
import type {Agent} from './agent.ts'
import {codeEvidence, guardedWorkspace, verifySources} from './approval-code.ts'
import {
  cancellable,
  errorMessage,
  executionContext,
  useContext,
} from './context.ts'
import {parseConversation} from './conversation.ts'
import type {ActionInvocation, ContextRecord, Evaluation} from './core-types.ts'
import {defineExtension} from './extensions.ts'
import {Modules} from './modules.ts'
import type {
  ApprovalAction,
  ApprovalMode,
  ApprovalOptions,
  ApprovalRequest,
  ApprovalReview,
  ApprovalServices,
  Provider,
} from './types.ts'

const denied = Symbol.for('msh.approval-denied')
export class ApprovalDenied extends Error {
  readonly [denied] = true
  static [Symbol.hasInstance](value: unknown): boolean {
    return value instanceof Error && (value as ApprovalDenied)[denied] === true
  }
}

async function review(
  request: ApprovalRequest,
  provider: Provider | undefined,
  signal: AbortSignal,
): Promise<ApprovalReview> {
  if (!provider)
    return {decision: 'ask', reason: 'No approval reviewer is available.'}
  const data = JSON.stringify(request)
  if (data.length > 64_000)
    return {
      decision: 'ask',
      reason: 'This action exceeds the automatic review size limit.',
    }
  const prompt = await readFile(
    fileURLToPath(import.meta.resolve('msh/prompts/approve.ms')),
    'utf8',
  )
  const result = await provider.complete(
    {
      purpose: 'approval',
      tools: [],
      maxOutputTokens: 1200,
      messages: [
        {role: 'system', content: prompt},
        {role: 'user', content: data},
      ],
    },
    signal,
    () => {},
  )
  if (result.message.role !== 'assistant' || result.message.tool_calls?.length)
    throw new Error('The reviewer must return a decision without tool calls')
  const raw = (result.message.content ?? '').trim()
  const body = /^```(?:json)?\s*\n([\s\S]*?)\n```$/u.exec(raw)?.[1] ?? raw
  const decision: ApprovalReview = JSON.parse(body)
  if (
    !decision ||
    !['approve', 'ask'].includes(decision.decision) ||
    typeof decision.reason !== 'string' ||
    !decision.reason.trim()
  )
    throw new Error('The reviewer returned an invalid decision')
  return decision
}

function humanControl() {
  if (executionContext.getStore())
    throw new Error(
      'Approval decisions and settings belong to the host interface',
    )
}

/** Approval is host policy; it does not add a kernel operation or a model tool. */
export class Approvals {
  private modeValue: ApprovalMode
  private interfaces = 0
  private readonly requests = new Map<string, ApprovalRequest>()
  private readonly decisions = new Map<string, (allow: boolean) => void>()
  constructor(
    private readonly options: ApprovalOptions,
    private readonly event: (
      thread: string,
      type: string,
      data: unknown,
    ) => void,
  ) {
    this.modeValue = options.mode ?? 'auto'
  }
  close() {
    for (const decide of this.decisions.values()) decide(false)
  }
  get mode() {
    return this.modeValue
  }
  setMode(mode: ApprovalMode) {
    humanControl()
    if (mode !== 'auto' && mode !== 'manual')
      throw new Error('Unknown approval mode')
    this.modeValue = mode
    this.event('', 'approval.mode', {mode})
  }
  list(thread?: string): ApprovalRequest[] {
    return structuredClone(
      [...this.requests.values()].filter((r) => !thread || r.thread === thread),
    )
  }
  connect(): () => void {
    humanControl()
    this.interfaces++
    let connected = true
    return () => {
      if (!connected) return
      connected = false
      this.interfaces--
      if (!this.interfaces)
        for (const decide of this.decisions.values()) decide(false)
    }
  }
  decide(id: string, decision: 'approve' | 'deny') {
    humanControl()
    const resolve = this.decisions.get(id)
    if (!resolve) throw new Error('Approval is no longer pending')
    if (decision !== 'approve' && decision !== 'deny')
      throw new Error('Unknown approval decision')
    this.decisions.delete(id)
    resolve(decision === 'approve')
  }
  async require(
    action: ApprovalAction,
    context: {
      thread: string
      cwd: string
      userRequests: string[]
      provider?: Provider
      signal: AbortSignal
      waiting: () => void
    },
  ): Promise<void> {
    const {signal} = context
    signal.throwIfAborted()
    const request: ApprovalRequest = {
      ...structuredClone(action),
      id: crypto.randomUUID(),
      thread: context.thread,
      cwd: context.cwd,
      time: new Date().toISOString(),
      userRequests: [...context.userRequests],
      status: this.mode === 'auto' ? 'reviewing' : 'pending',
      reason: '',
    }
    this.requests.set(request.id, request)
    this.event(request.thread, 'approval.request', request)
    try {
      let allowed = false
      let by = 'policy'
      const services: ApprovalServices = {
        get mode() {
          return manager.mode
        },
        review: async () => {
          let result: ApprovalReview
          try {
            const reviewSignal = AbortSignal.any([
              signal,
              AbortSignal.timeout(60_000),
            ])
            result = await cancellable(
              this.options.reviewer
                ? this.options.reviewer(structuredClone(request), reviewSignal)
                : review(request, context.provider, reviewSignal),
              reviewSignal,
            )
            if (
              !result ||
              !['approve', 'ask'].includes(result.decision) ||
              !result.reason?.trim()
            )
              throw new Error('The reviewer returned an invalid decision')
          } catch (error) {
            signal.throwIfAborted()
            result = {
              decision: 'ask',
              reason: `Automatic review unavailable: ${errorMessage(error)}`,
            }
          }
          signal.throwIfAborted()
          by = 'reviewer'
          this.event(request.thread, 'approval.review', {
            id: request.id,
            ...result,
          })
          return result
        },
        approve: (reason) => {
          signal.throwIfAborted()
          allowed = true
          this.event(request.thread, 'approval.decision', {
            id: request.id,
            decision: 'approve',
            by,
            reason,
          })
        },
        deny: (reason): never => {
          this.event(request.thread, 'approval.decision', {
            id: request.id,
            decision: 'deny',
            by,
            reason,
          })
          throw new ApprovalDenied(reason)
        },
        ask: async (reason, presentation) => {
          signal.throwIfAborted()
          request.status = 'pending'
          request.reason = reason
          if (
            !presentation.title ||
            !presentation.body ||
            presentation.body.type !== 'root' ||
            !presentation.choices.some((c) => c.value === 'deny') ||
            !presentation.choices.some((c) => c.value === 'approve') ||
            presentation.choices.some(
              (c) => !['approve', 'deny'].includes(c.value),
            )
          )
            return services.deny(
              'Approval policy returned an invalid UI request',
            )
          toMarkdown(presentation.body)
          request.presentation = structuredClone(presentation)
          if (!this.interfaces)
            return services.deny(
              `Approval required: ${request.title}. ${reason} Open the WebUI or connect an approval interface to decide.`,
            )
          const decision = new Promise<boolean>((resolve) =>
            this.decisions.set(request.id, resolve),
          )
          context.waiting()
          this.event(request.thread, 'approval.pending', request)
          const approved = await cancellable(decision, signal)
          signal.throwIfAborted()
          by = 'user'
          return approved
        },
      }
      const manager = this
      const filename = this.options.policy
        ? path.resolve(context.cwd, this.options.policy)
        : fileURLToPath(import.meta.resolve('msh/prompts/approval-policy.ms'))
      const policy = (await import(pathToFileURL(filename).href)) as {
        beforeAction: (
          action: ApprovalRequest,
          services: ApprovalServices,
        ) => Promise<void>
      }
      if (typeof policy.beforeAction !== 'function')
        throw new Error(
          'Approval policy must export beforeAction(action, services)',
        )
      await cancellable(
        Promise.resolve(
          policy.beforeAction(structuredClone(request), services),
        ),
        signal,
      )
      if (!allowed)
        services.deny('Approval policy ended without approving the action')
    } catch (error) {
      if (signal.aborted)
        this.event(request.thread, 'approval.cancelled', {
          id: request.id,
          reason: errorMessage(signal.reason),
        })
      throw error instanceof ApprovalDenied || signal.aborted
        ? error
        : new ApprovalDenied(`Approval policy failed: ${errorMessage(error)}`)
    } finally {
      this.decisions.delete(request.id)
      this.requests.delete(request.id)
    }
  }
}

export function approval(
  options: ApprovalOptions = {},
  beforeAction?: (
    action: import('./types.ts').ActionInvocation,
  ) => Promise<void>,
) {
  return defineExtension('msh.approval', (scope) => {
    const host = scope.host
    const modules = new Modules()
    const requests = new Map<string, string[]>()
    const manager = scope.provide(
      'msh.approvals',
      new Approvals(options, (id, type, data) =>
        host.record(id || host.root, type, data),
      ),
    )
    const capture = (thread: string, records: ContextRecord[]) => {
      const current = requests.get(thread) ?? []
      current.push(
        ...records
          .flatMap((r) => parseConversation(r.text))
          .filter((m) => m.role === 'user')
          .map((m) => m.content ?? ''),
      )
      requests.set(thread, current)
    }
    scope.hook<{thread: string; messages: ContextRecord[]}>(
      'context.before',
      ({thread, messages}) => {
        if (
          thread === host.root &&
          host.inspect(thread).state === 'initializing'
        )
          capture(thread, messages)
      },
    )
    scope.hook<{thread: string; records: ContextRecord[]; fromUser: boolean}>(
      'messages.commit',
      ({thread, records, fromUser}) => {
        if (fromUser) capture(thread, records)
      },
    )
    scope.hook<Evaluation>('evaluate.before', async (evaluation) => {
      const evidence = await codeEvidence(
        evaluation.module,
        evaluation.source,
        evaluation.resolve,
      )
      await host.authorize({
        kind: 'code',
        title: `Evaluate ${path.basename(evaluation.module)}`,
        details: {
          ...evidence,
          ...(evaluation.input === undefined ? {} : {input: evaluation.input}),
        },
      })
      await verifySources(evidence)
      useContext()
    })
    scope.hook<ActionInvocation>('action.before', async (action) => {
      const details = {...action.details}
      if (action.kind === 'ability' && typeof details.module === 'string') {
        const source =
          (await import('@markscript/compiler').then((m) =>
            m.registeredModuleSources().get(String(details.module)),
          )) ?? (await readFile(String(details.module), 'utf8'))
        const evidence = await codeEvidence(
          String(details.module),
          source,
          modules.resolve.bind(modules),
        )
        Object.assign(details, evidence, {
          guarded: details.module === guardedWorkspace,
        })
      }
      if (beforeAction) {
        try {
          await beforeAction({
            ...action,
            details,
          } as import('./types.ts').ActionInvocation)
        } catch (error) {
          action.signal.throwIfAborted()
          throw new ApprovalDenied(
            `Before-action hook stopped ${action.title}: ${errorMessage(error)}`,
          )
        }
      }
      const userRequests: string[] = []
      let id: string | undefined = action.thread
      while (id) {
        userRequests.unshift(...(requests.get(id) ?? []))
        id = host.inspect(id).parent
      }
      const provider = host
        .service<Agent>('msh.agent', action.thread)
        ?.provider(action.thread)
      await manager.require(
        {kind: action.kind, title: action.title, details} as ApprovalAction,
        {
          thread: action.thread,
          cwd: action.cwd,
          signal: action.signal,
          userRequests,
          ...(provider ? {provider} : {}),
          waiting: () => {},
        },
      )
    })
    return () => {
      manager.close()
    }
  })
}
