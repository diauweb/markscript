import {type Agent, agent} from './agent.ts'
import {type Approvals, approval} from './approval.ts'
import {user} from './conversation.ts'
import type {
  Delivery,
  Handle,
  Recipient,
  RuntimeEvent,
  Target,
  ThreadContext,
} from './core-types.ts'
import {Harness} from './host.ts'
import type {Provider, ShellOptions} from './types.ts'

export class Shell {
  readonly runtime: Harness
  readonly agents: Agent
  readonly approvals: Approvals
  private readonly unsubscribe: (() => void) | undefined
  private closing: Promise<void> | undefined
  constructor(readonly options: ShellOptions = {}) {
    this.runtime = new Harness({
      ...(options.cwd ? {cwd: options.cwd} : {}),
      ...(options.context ? {context: options.context} : {}),
      ...(options.onEvent ? {onEvent: options.onEvent} : {}),
      extensions: [
        agent(options),
        approval(options.approval, options.beforeAction),
        ...(options.extensions ?? []),
      ],
    })
    const agents = this.runtime.service<Agent>('msh.agent')
    const approvals = this.runtime.service<Approvals>('msh.approvals')
    if (!agents || !approvals)
      throw new Error('Shell extensions failed to install')
    this.agents = agents
    this.approvals = approvals
    if (options.observer) {
      const observer = options.observer
      this.unsubscribe = this.runtime.subscribe((event) =>
        observer.event(event),
      )
      for (const event of this.runtime.events) {
        try {
          observer.event(event)
        } catch {}
      }
    }
  }
  private agent(id = this.root): Agent {
    return this.runtime.service<Agent>('msh.agent', id) ?? this.agents
  }
  get root() {
    return this.runtime.root
  }
  get events() {
    return this.runtime.events
  }
  async initialize() {
    try {
      await this.runtime.initialize()
    } catch (error) {
      try {
        await this.close()
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Shell initialization failed',
        )
      }
      throw error
    }
    return this
  }
  subscribe(listener: (event: RuntimeEvent) => void) {
    return this.runtime.subscribe(listener)
  }
  spawn(
    target: Target,
    parent = this.root,
    purpose: import('./types.ts').ModelRequest['purpose'] = 'turn',
  ) {
    return this.agent(parent).spawn(target, parent, purpose)
  }
  send(target: Recipient, message: Delivery, sender?: Handle) {
    return this.runtime.send(target, message, sender)
  }
  wait(id?: Handle, caller?: Handle, signal?: AbortSignal) {
    return this.agent(id ?? caller).wait(id, caller, signal)
  }
  inspect(id = this.root, last_k_msg = 1) {
    const snapshot = this.agent(id).inspect(id, last_k_msg)
    snapshot.approvals = this.approvals.list(id)
    const request = snapshot.approvals[0]
    if (request)
      snapshot.state = request.status === 'reviewing' ? 'reviewing' : 'approval'
    return snapshot
  }
  list() {
    return this.runtime.list().map(({id}) => this.inspect(id))
  }
  setProvider(provider: Provider, id = this.root) {
    this.agent(id).setProvider(provider, id)
  }
  replace(id: Handle, context: ThreadContext) {
    return this.runtime.replace(id, context)
  }
  replaceIdle(id: Handle, context: ThreadContext) {
    return this.runtime.replaceIdle(id, context)
  }
  async turn(text: string, id = this.root) {
    await this.send(id, user(text))
    await this.wait(id)
    return this.inspect(id, 0)
  }
  close() {
    this.closing ??= this.shutdown()
    return this.closing
  }
  private async shutdown() {
    try {
      await this.runtime.close()
    } finally {
      this.unsubscribe?.()
      await this.options.observer?.flush()
    }
  }
}
export async function createShell(options: ShellOptions = {}): Promise<Shell> {
  return new Shell(options).initialize()
}
