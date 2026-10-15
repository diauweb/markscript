import path from 'node:path'
import {
  ContextTransfer,
  cancellable,
  type ExecutionContext,
  errorMessage,
  executionContext,
} from './context.ts'
import type {
  ActionInvocation,
  Binding,
  ContextPart,
  ContextPreparation,
  ContextRecord,
  Delivery,
  Handle,
  Operation,
  Options,
  Prepared,
  Recipient,
  RuntimeEvent,
  Snapshot,
  State,
  Target,
  ThreadContext,
  WaitResult,
} from './core-types.ts'
import {type Extension, ExtensionScope, isExtension} from './extensions.ts'
import {Modules, serialize} from './modules.ts'

interface Envelope {
  parts: ContextPart[]
  cwd: string
  fromUser: boolean
}
interface Thread {
  id: Handle
  parent?: Handle
  kind: 'context' | 'code'
  state: State
  cwd: string
  children: Set<Handle>
  inbox: Envelope[]
  history: ContextRecord[]
  instructions: ContextRecord[]
  messages: ContextRecord[]
  modules: ContextRecord[]
  bindings: Map<string, Binding>
  scopes: ExtensionScope[]
  revision: number
  invocation: string
  controller: AbortController
  terminated: boolean
  work?: Promise<void>
  jobs: Set<Promise<unknown>>
  wake: Set<() => void>
  settled: Set<() => void>
  error?: string
  result?: unknown
}

export class Harness {
  readonly root: Handle
  readonly events: RuntimeEvent[] = []
  readonly options: Options
  private readonly threads = new Map<Handle, Thread>()
  private readonly modules = new Modules()
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()
  private readonly hostScopes: ExtensionScope[] = []
  private readonly ready: Promise<void>[] = []
  private closed = false
  private closing: Promise<void> | undefined
  constructor(options: Options = {}) {
    this.options = options
    this.root = this.create('context').id
    for (const extension of options.extensions ?? []) this.use(extension)
  }
  use(extension: Extension): ExtensionScope {
    if (executionContext.getStore())
      throw new Error('Host extensions belong to the host interface')
    if (this.closed) throw new Error('Harness is closed')
    const scope = new ExtensionScope(this)
    this.hostScopes.push(scope)
    this.ready.push(
      scope.activate(extension).then(() => {
        scope.commit()
        if (this.get(this.root).state !== 'initializing') scope.start()
      }),
    )
    return scope
  }
  service<T>(name: string, id?: Handle, includeContext = true): T | undefined {
    const scopes = [
      ...this.hostScopes,
      ...(id && includeContext ? this.get(id).scopes : []),
    ].flatMap((scope) => scope.flatten())
    for (const scope of scopes.reverse())
      if (!scope.signal.aborted && scope.services.has(name))
        return scope.services.get(name) as T
    return undefined
  }
  extension(name: string, id: Handle): Extension | undefined {
    for (const scope of this.get(id)
      .scopes.flatMap((scope) => scope.flatten())
      .reverse()) {
      const extension = scope.extensions.get(name)
      if (extension) return extension
    }
    return undefined
  }
  private create(kind: Thread['kind'], parent?: Handle): Thread {
    if (this.closed) throw new Error('Harness is closed')
    const owner = parent ? this.get(parent) : undefined
    if (owner?.terminated) throw new Error('Parent thread is closing')
    const t: Thread = {
      id: crypto.randomUUID(),
      ...(parent ? {parent} : {}),
      kind,
      state: 'initializing',
      cwd: owner?.cwd ?? path.resolve(this.options.cwd ?? process.cwd()),
      children: new Set(),
      inbox: [],
      history: [],
      instructions: [],
      messages: [],
      modules: [],
      bindings: new Map(),
      scopes: [],
      revision: 0,
      invocation: crypto.randomUUID(),
      controller: new AbortController(),
      terminated: false,
      jobs: new Set(),
      wake: new Set(),
      settled: new Set(),
    }
    this.threads.set(t.id, t)
    owner?.children.add(t.id)
    const caller = executionContext.getStore()
    this.record(t.id, 'thread.created', {
      kind,
      parent,
      cwd: t.cwd,
      ...(caller?.host === this && caller.thread === parent
        ? {
            parentInvocation: caller.invocation,
            ...(caller.span ? {parentSpan: caller.span} : {}),
          }
        : {}),
    })
    return t
  }
  private get(id: Handle): Thread {
    const t = this.threads.get(id)
    if (!t) throw new Error(`Unknown thread: ${id}`)
    return t
  }
  signal(id: Handle): AbortSignal {
    return this.get(id).controller.signal
  }
  assertRevision(id: Handle, revision: number) {
    if (this.get(id).revision !== revision) throw new ContextTransfer()
  }
  private scopes(id: Handle, staged?: ExtensionScope): ExtensionScope[] {
    return [
      ...this.hostScopes,
      ...(staged?.replacing ? [] : this.get(id).scopes),
      ...(staged ? [staged] : []),
    ].flatMap((scope) => scope.flatten())
  }
  async hook<T>(
    name: string,
    value: T,
    staged?: ExtensionScope,
    id = executionContext.getStore()?.thread ?? this.root,
  ): Promise<void> {
    const caller = executionContext.getStore()
    if (caller?.host !== this || caller.thread !== id)
      return this.execute(id, () => this.hook(name, value, staged, id))
    const t = this.get(id)
    const signal = executionContext.getStore()?.signal ?? t.controller.signal
    for (const scope of this.scopes(
      id,
      staged ?? executionContext.getStore()?.registration,
    )) {
      for (const callback of [...(scope.hooks.get(name) ?? [])]) {
        signal.throwIfAborted()
        const revision = t.revision
        const callbackSignal = AbortSignal.any([signal, scope.signal])
        try {
          await cancellable(
            this.execute(
              id,
              async () => callback(value as never),
              staged ?? caller.registration,
              callbackSignal,
            ),
            callbackSignal,
          )
        } catch (error) {
          if (t.revision !== revision) throw new ContextTransfer()
          throw error
        }
        signal.throwIfAborted()
      }
    }
  }
  async authorize(
    action: Operation,
    id = executionContext.getStore()?.thread ?? this.root,
  ): Promise<void> {
    const caller = executionContext.getStore()
    if (caller?.host !== this || caller.thread !== id)
      return this.execute(id, () => this.authorize(action, id))
    const t = this.get(id)
    const signal = executionContext.getStore()?.signal ?? t.controller.signal
    const revision = t.revision
    this.record(id, 'action.before', action)
    await this.hook<ActionInvocation>(
      'action.before',
      {...action, thread: id, cwd: t.cwd, signal},
      undefined,
      id,
    )
    signal.throwIfAborted()
    this.assertRevision(id, revision)
  }
  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  record(id: Handle, type: string, data: unknown, invocation?: string): void {
    const t = this.get(id)
    const caller = executionContext.getStore()
    const context =
      caller?.host === this &&
      caller.thread === id &&
      (invocation === undefined || invocation === caller.invocation)
        ? caller
        : undefined
    const event: RuntimeEvent = {
      seq: this.events.length + 1,
      time: new Date().toISOString(),
      thread: id,
      invocation: invocation ?? context?.invocation ?? t.invocation,
      ...(context?.span ? {span: context.span} : {}),
      ...(context?.parentSpan ? {parentSpan: context.parentSpan} : {}),
      type,
      data: JSON.parse(serialize(data)),
    }
    this.events.push(event)
    const observers = [this.options.onEvent, ...this.listeners]
    for (const scope of this.scopes(id))
      for (const listener of scope.listeners)
        if (listener.type === type || listener.type === '*')
          observers.push(listener.callback)
    for (const observer of observers) {
      try {
        void Promise.resolve(observer?.(event)).catch(() => {})
      } catch {}
    }
  }
  private state(t: Thread, state: State, invocation = t.invocation) {
    t.state = state
    this.record(t.id, 'thread.state', {state, invocation}, invocation)
    if (state === 'idle' || state === 'dead')
      for (const wake of [...t.settled]) wake()
  }
  execute<T>(
    id: Handle,
    fn: (context: ExecutionContext) => Promise<T>,
    registration?: ExtensionScope,
    signal?: AbortSignal,
  ): Promise<T> {
    const t = this.get(id)
    const caller = executionContext.getStore()
    const inherited =
      caller?.host === this && caller.thread === id ? caller : undefined
    const activeSignal = signal ?? inherited?.signal ?? t.controller.signal
    activeSignal.throwIfAborted()
    if (inherited) this.assertRevision(id, inherited.revision)
    const context: ExecutionContext = {
      host: this,
      thread: id,
      cwd: t.cwd,
      signal: activeSignal,
      revision: t.revision,
      actions: 0,
      invocation: inherited?.invocation ?? t.invocation,
      ...(inherited?.span ? {span: inherited.span} : {}),
      ...(inherited?.parentSpan ? {parentSpan: inherited.parentSpan} : {}),
      ...(registration ? {registration} : {}),
    }
    return executionContext.run(context, () => fn(context))
  }
  activity<T>(
    id: Handle,
    kind: 'evaluation' | 'ability',
    name: string,
    input: unknown,
    operation: (context: ExecutionContext) => Promise<T>,
  ): Promise<T> {
    return this.execute(id, async (context) => {
      const span = crypto.randomUUID()
      if (context.span) context.parentSpan = context.span
      else delete context.parentSpan
      context.span = span
      this.record(id, 'activity.start', {id: span, kind, name, input})
      try {
        const output = await cancellable(
          Promise.resolve().then(() => operation(context)),
          context.signal,
        )
        this.record(id, 'activity.end', {id: span, kind, name, output})
        return output
      } catch (error) {
        const transferred =
          error instanceof ContextTransfer ||
          this.get(id).revision !== context.revision
        this.record(id, 'activity.end', {
          id: span,
          kind,
          name,
          ...(transferred ? {transferred: true} : {error: errorMessage(error)}),
          ...(!transferred && context.signal.aborted ? {cancelled: true} : {}),
        })
        throw transferred ? new ContextTransfer() : error
      }
    })
  }
  async initialize() {
    const t = this.get(this.root)
    try {
      await Promise.all(this.ready)
      await this.execute(t.id, () =>
        this.install(
          t,
          this.options.context ?? {instructions: [], messages: []},
        ),
      )
      for (const scope of this.hostScopes) scope.start()
      if (!t.work && !t.jobs.size) this.state(t, 'idle')
    } catch (error) {
      if (error instanceof ContextTransfer) {
        this.launch(t, () => this.input(t))
        return this
      }
      t.error = errorMessage(error)
      this.record(t.id, 'error', {message: t.error})
      await this.close()
      throw error
    }
    return this
  }
  private async install(
    t: Thread,
    context: ThreadContext,
    revision = t.revision,
  ) {
    if (
      !context ||
      Array.isArray(context) ||
      !Array.isArray(context.instructions) ||
      !Array.isArray(context.messages)
    )
      throw new Error('Context requires {instructions: [...], messages: [...]}')
    const stage = new ExtensionScope(this, t.id)
    stage.replacing = true
    try {
      const messages = await this.modules.read(context.messages, t.cwd)
      await this.hook(
        'context.before',
        {thread: t.id, context, messages, scope: stage},
        stage,
        t.id,
      )
      const prepared = await this.execute(
        t.id,
        () =>
          this.modules.prepare(context.instructions, t.cwd, new Map(), stage),
        stage,
      )
      const draft: ContextPreparation = {
        thread: t.id,
        context,
        prepared,
        messages,
        replacing: true,
        scope: stage,
      }
      await this.hook('context.prepare', draft, stage, t.id)
      t.controller.signal.throwIfAborted()
      this.assertRevision(
        t.id,
        executionContext.getStore()?.revision ?? t.revision,
      )
      stage.commit()
      const old = t.scopes
      t.kind = 'context'
      t.revision = revision
      t.instructions = [...prepared.records]
      t.messages = messages
      t.modules = [...prepared.records, ...messages]
      t.bindings = prepared.bindings
      t.scopes = [stage]
      t.history.push(...messages)
      this.recordContext(t)
      await this.disposeScopes(old, t.id)
      stage.start()
    } catch (error) {
      await stage.close()
      throw error
    }
  }
  private recordContext(t: Thread) {
    this.record(t.id, 'context', {
      generation: t.revision,
      instructions: t.instructions,
      messages: t.messages,
      records: t.modules,
      bindings: [...t.bindings.values()].map(({name, module}) => ({
        name,
        module,
      })),
      extensions: this.contextExtensions(t),
    })
  }
  async evaluate(
    id: Handle,
    parts: import('./core-types.ts').InstructionPart[],
  ): Promise<Prepared> {
    const caller = executionContext.getStore()
    if (caller?.host !== this || caller.thread !== id)
      return this.managed(id, () => this.evaluate(id, parts))
    return this.activity(
      id,
      'evaluation',
      'Evaluate MarkScript',
      {parts},
      async () => {
        const t = this.get(id)
        const stage = new ExtensionScope(this, id)
        try {
          const result = await this.execute(
            id,
            async (c) => {
              const result = await this.modules.prepare(
                parts,
                t.cwd,
                t.bindings,
                stage,
              )
              result.acted ||= c.actions > 0
              return result
            },
            stage,
          )
          await this.hook(
            'context.append',
            {thread: id, prepared: result, scope: stage},
            stage,
            id,
          )
          t.controller.signal.throwIfAborted()
          this.assertRevision(
            id,
            executionContext.getStore()?.revision ?? t.revision,
          )
          stage.commit()
          t.instructions.push(...result.records)
          t.modules.push(...result.records)
          for (const [name, binding] of result.bindings)
            t.bindings.set(name, binding)
          t.scopes.push(stage)
          this.recordContext(t)
          stage.start()
          return result
        } catch (error) {
          await stage.close()
          throw error
        }
      },
    )
  }
  bindings(id: Handle): ReadonlyMap<string, Binding> {
    return new Map(this.get(id).bindings)
  }
  async invoke(id: Handle, name: string, args: unknown[]): Promise<unknown> {
    const caller = executionContext.getStore()
    if (caller?.host !== this || caller.thread !== id)
      return this.managed(id, () => this.invoke(id, name, args))
    const binding = this.get(id).bindings.get(name)
    if (!binding || typeof binding.value !== 'function')
      throw new Error(`Unknown callable: ${name}`)
    const fn = binding.value
    return this.activity(
      id,
      'ability',
      name,
      {module: binding.module, arguments: args},
      async (c) => {
        await this.authorize(
          {
            kind: 'ability',
            title: `Call ${name}`,
            details: {module: binding.module, export: name, arguments: args},
          },
          id,
        )
        const result = await fn(...args)
        c.signal.throwIfAborted()
        this.assertRevision(id, c.revision)
        return result
      },
    )
  }
  async spawn(target: Target, parent = this.root): Promise<Handle> {
    if (!target || typeof target !== 'object' || Array.isArray(target))
      throw new Error('spawn expects {instructions, messages} or a code module')
    const context = 'instructions' in target || 'messages' in target
    const t = this.create(context ? 'context' : 'code', parent)
    this.launch(t, async () => {
      if (context) {
        await this.execute(t.id, () => this.install(t, target as ThreadContext))
        await this.input(t)
      } else {
        if (!('module' in target))
          await this.authorize(
            {
              kind: 'code',
              title: 'Run code thread entry',
              details: {
                source: String(target.default),
                note: 'Closure values are not available to static review.',
              },
            },
            t.id,
          )
        const stage = new ExtensionScope(this, t.id)
        let module: import('./core-types.ts').CodeModule
        try {
          module =
            'module' in target
              ? await this.execute(
                  t.id,
                  () => this.modules.code(target.module, t.cwd, stage),
                  stage,
                )
              : target
          if (!('module' in target))
            for (const value of Object.values(module))
              if (isExtension(value)) await stage.activate(value)
          t.controller.signal.throwIfAborted()
          stage.commit()
          t.scopes.push(stage)
          stage.start()
        } catch (error) {
          await stage.close()
          throw error
        }
        if (typeof module.default !== 'function')
          throw new Error('Code module must default-export its entry function')
        const result = await this.execute(
          t.id,
          async () => await module.default(),
        )
        t.controller.signal.throwIfAborted()
        t.result = result
        this.record(t.id, 'result', JSON.parse(serialize(result)))
      }
    })
    return t.id
  }
  private async input(t: Thread) {
    await this.execute(t.id, () => this.hook('input', {thread: t.id}))
  }
  private managed<T>(id: Handle, operation: () => Promise<T>): Promise<T> {
    const t = this.get(id)
    if (t.terminated) throw new Error(`Thread is ${t.state}: ${id}`)
    if (t.controller.signal.aborted && t.state === 'idle')
      t.controller = new AbortController()
    const signal = t.controller.signal
    signal.throwIfAborted()
    const invocation = crypto.randomUUID()
    this.record(
      id,
      'invocation.start',
      {invocation, kind: 'managed'},
      invocation,
    )
    this.state(t, 'running', invocation)
    let failure: {error: unknown; cancelled: boolean} | undefined
    const job = Promise.resolve()
      .then(() =>
        cancellable(
          this.execute(id, async (context) => {
            context.invocation = invocation
            return operation()
          }),
          signal,
        ),
      )
      .catch((error) => {
        failure = {error, cancelled: signal.aborted}
        throw error
      })
      .finally(() => {
        this.record(
          id,
          'invocation.end',
          {
            invocation,
            ...(failure
              ? failure.error instanceof ContextTransfer
                ? {transferred: true}
                : {
                    error: errorMessage(failure.error),
                    ...(failure.cancelled ? {cancelled: true} : {}),
                  }
              : {}),
          },
          invocation,
        )
        t.jobs.delete(job)
        if (!t.work && !t.jobs.size && !t.terminated) {
          this.state(t, 'idle', invocation)
          if (t.inbox.length && this.hasInput(t))
            this.launch(t, () => this.input(t))
        }
      })
    t.jobs.add(job)
    return job
  }
  private hasInput(t: Thread) {
    return this.scopes(t.id).some((s) => s.hooks.get('input')?.size)
  }
  private launch(t: Thread, operation: () => Promise<void>) {
    if (t.work || t.terminated) return
    if (t.controller.signal.aborted) t.controller = new AbortController()
    delete t.error
    const invocation = crypto.randomUUID()
    t.invocation = invocation
    const signal = t.controller.signal
    this.record(
      t.id,
      'invocation.start',
      {invocation, kind: 'turn'},
      invocation,
    )
    this.state(t, 'running', invocation)
    let failure: {error: unknown; cancelled: boolean} | undefined
    t.work = Promise.resolve()
      .then(async () => {
        let next = operation
        while (!t.terminated) {
          try {
            await cancellable(next(), t.controller.signal)
            if (t.kind === 'code') await this.terminate(t)
            return
          } catch (error) {
            if (!(error instanceof ContextTransfer)) throw error
            next = () => this.input(t)
          }
        }
      })
      .catch(async (error) => {
        failure = {error, cancelled: signal.aborted}
        if (!t.controller.signal.aborted) {
          t.error = errorMessage(error)
          this.record(t.id, 'error', {message: t.error}, invocation)
        }
        if (t.kind === 'code') await this.terminate(t)
      })
      .finally(async () => {
        if (t.terminated)
          await Promise.all([...t.children].map((id) => this.get(id).work))
        this.record(
          t.id,
          'invocation.end',
          {
            invocation,
            ...(failure
              ? {
                  error: errorMessage(failure.error),
                  ...(failure.cancelled ? {cancelled: true} : {}),
                }
              : {}),
          },
          invocation,
        )
        delete t.work
        if (t.terminated) this.state(t, 'dead', invocation)
        else if (!t.jobs.size) {
          this.state(t, 'idle', invocation)
          if (
            t.inbox.length &&
            this.hasInput(t) &&
            !t.controller.signal.aborted &&
            !t.error
          )
            this.launch(t, () => this.input(t))
        }
      })
  }
  run(
    scope: ExtensionScope,
    callback: (context: ExecutionContext) => Promise<unknown>,
  ): void {
    const t = this.get(scope.thread ?? this.root)
    const signal = AbortSignal.any([scope.signal, t.controller.signal])
    this.state(t, 'running')
    const job = Promise.resolve()
      .then(() =>
        cancellable(this.execute(t.id, callback, undefined, signal), signal),
      )
      .catch((error) => {
        if (!signal.aborted) {
          t.error = errorMessage(error)
          this.record(t.id, 'error', {message: t.error})
        }
      })
      .finally(() => {
        t.jobs.delete(job)
        if (!t.work && !t.jobs.size && !t.terminated) this.state(t, 'idle')
      })
    t.jobs.add(job)
  }
  async send(
    target: Recipient,
    delivery: Delivery,
    sender?: Handle,
  ): Promise<void> {
    const ids =
      target === 'descendants'
        ? this.descendants(sender ?? this.root).filter(
            (id) => !this.get(id).terminated,
          )
        : Array.isArray(target)
          ? target
          : [target]
    for (const id of ids) {
      const t = this.get(id === 'self' ? (sender ?? this.root) : id)
      if (
        typeof delivery === 'object' &&
        !Array.isArray(delivery) &&
        'control' in delivery
      ) {
        if (delivery.control === 'terminate') await this.terminate(t)
        else if (delivery.control === 'interrupt') {
          if (t.state !== 'idle' && t.state !== 'dead') {
            this.state(t, 'stopping')
            t.controller.abort(new Error('Interrupted'))
            this.record(t.id, 'interrupted', {})
          }
        } else throw new Error('Unknown runtime control')
        continue
      }
      if (t.terminated) throw new Error(`Thread is ${t.state}: ${t.id}`)
      const parts = typeof delivery === 'string' ? [delivery] : delivery
      if (!Array.isArray(parts))
        throw new Error('Messages must contain MarkScript')
      t.inbox.push({
        parts,
        cwd: sender ? this.get(sender).cwd : t.cwd,
        fromUser: !sender && !executionContext.getStore(),
      })
      this.record(t.id, 'inbox', {pending: t.inbox.length})
      for (const wake of [...t.wake]) wake()
      if (t.kind === 'context' && t.state === 'idle' && this.hasInput(t))
        this.launch(t, () => this.input(t))
    }
  }
  private descendants(id: Handle): Handle[] {
    return [...this.get(id).children].flatMap((child) => [
      child,
      ...this.descendants(child),
    ])
  }
  private async disposeScopes(
    scopes: ExtensionScope[],
    id: Handle,
  ): Promise<void> {
    const results = await Promise.allSettled(
      scopes.map((scope) => scope.close()),
    )
    for (const result of results)
      if (result.status === 'rejected') {
        const error = result.reason
        this.record(id, 'cleanup.error', {
          message: errorMessage(error),
          causes:
            error instanceof AggregateError
              ? error.errors.map(errorMessage)
              : [],
        })
      }
  }
  private async terminate(t: Thread) {
    if (t.terminated) return
    t.terminated = true
    this.state(t, 'stopping')
    t.controller.abort(new Error('Terminated'))
    await Promise.all(
      [...t.children].map((child) => this.terminate(this.get(child))),
    )
    const scopes = t.scopes.splice(0)
    await this.disposeScopes(scopes, t.id)
    await Promise.allSettled([...t.jobs])
    if (!t.work) {
      await Promise.all([...t.children].map((id) => this.get(id).work))
      this.state(t, 'dead')
    }
  }
  private contextExtensions(t: Thread) {
    return t.scopes
      .flatMap((scope) => scope.flatten())
      .flatMap(({origin, extensions}) =>
        origin
          ? [...extensions.keys()].map((name) => ({name, module: origin}))
          : [],
      )
  }
  inspect(id = this.root): Snapshot {
    const t = this.get(id)
    const snapshot = {
      id: t.id,
      ...(t.parent ? {parent: t.parent} : {}),
      kind: t.kind,
      state: t.state,
      cwd: t.cwd,
      generation: t.revision,
      pending: t.inbox.length,
      children: [...t.children],
      context: {instructions: t.instructions, messages: t.messages},
      modules: t.modules,
      bindings: [...t.bindings.values()].map(({name, module}) => ({
        name,
        module,
      })),
      extensions: this.contextExtensions(t),
      history: t.history,
      ...(t.error ? {error: t.error} : {}),
      ...(t.result === undefined
        ? {}
        : {result: JSON.parse(serialize(t.result))}),
    } satisfies Snapshot
    return JSON.parse(serialize(snapshot)) as Snapshot
  }
  list(): Snapshot[] {
    return [...this.threads.keys()].map((id) => this.inspect(id))
  }
  private async suspend(set: Set<() => void>, signal: AbortSignal) {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        set.delete(done)
        signal.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        set.delete(done)
        signal.removeEventListener('abort', abort)
        reject(signal.reason)
      }
      set.add(done)
      signal.addEventListener('abort', abort, {once: true})
    })
  }
  async wait(
    id?: Handle,
    caller?: Handle,
    signal = new AbortController().signal,
  ): Promise<WaitResult> {
    const self = caller ? this.get(caller) : undefined
    if (id) {
      if (id === caller)
        throw new Error('A thread cannot wait for itself to settle')
      const t = this.get(id)
      if (self) this.state(self, 'waiting')
      try {
        while (t.state !== 'idle' && t.state !== 'dead')
          await this.suspend(t.settled, signal)
      } finally {
        if (self && !signal.aborted) this.state(self, 'running')
      }
      return {
        reason: 'settled',
        thread: id,
        state: t.state,
        messages: t.history.slice(-1),
      }
    }
    if (!self) throw new Error('Inbox wait requires a calling thread')
    this.state(self, 'waiting')
    try {
      while (!self.inbox.length) await this.suspend(self.wake, signal)
      return {
        reason: 'message',
        thread: self.id,
        state: 'running',
        messages: await this.receive(self.id, false),
      }
    } finally {
      if (!signal.aborted) this.state(self, 'running')
    }
  }
  async receive(id: Handle, active = true): Promise<ContextRecord[]> {
    const t = this.get(id)
    const messages: ContextRecord[] = []
    while (t.inbox.length) {
      const envelope = t.inbox.shift()
      if (!envelope) break
      const records = await this.modules.read(envelope.parts, envelope.cwd)
      t.controller.signal.throwIfAborted()
      const input = {thread: id, records, active, fromUser: envelope.fromUser}
      await this.hook('messages.before', input, undefined, id)
      t.history.push(...records)
      if (active) t.messages.push(...records)
      messages.push(...records)
      await this.hook('messages.commit', input, undefined, id)
      for (const record of records) this.record(id, 'document', record)
    }
    return messages
  }
  async replace(id: Handle, context: ThreadContext): Promise<never> {
    const t = this.get(id)
    await this.install(t, context, t.revision + 1)
    this.record(id, 'exec', {generation: t.revision})
    throw new ContextTransfer()
  }
  async replaceIdle(id: Handle, context: ThreadContext) {
    const t = this.get(id)
    if (t.state !== 'idle')
      throw new Error('Context replacement requires an idle thread')
    this.launch(t, async () => {
      try {
        await this.execute(id, () => this.replace(id, context))
      } catch (error) {
        if (!(error instanceof ContextTransfer)) throw error
      }
      await this.input(t)
    })
    await this.wait(id)
  }
  close(): Promise<void> {
    this.closing ??= this.shutdown()
    return this.closing
  }
  private async shutdown() {
    this.closed = true
    try {
      await this.terminate(this.get(this.root))
      await Promise.all([...this.threads.values()].map((t) => t.work))
    } finally {
      await this.disposeScopes(this.hostScopes.splice(0).reverse(), this.root)
    }
  }
}
export async function createHarness(options: Options = {}): Promise<Harness> {
  return new Harness(options).initialize()
}
