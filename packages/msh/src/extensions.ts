import type {ExecutionContext} from './context.ts'
import type {RuntimeEvent} from './core-types.ts'
import type {Harness} from './host.ts'

const marker = Symbol.for('msh.extension')
export interface Extension {
  readonly [marker]: true
  readonly name: string
  setup(
    scope: ExtensionScope,
  ):
    | void
    | (() => void | Promise<void>)
    | Promise<void | (() => void | Promise<void>)>
}
export function defineExtension(
  name: string,
  setup: Extension['setup'],
): Extension {
  return {[marker]: true, name, setup}
}
export function isExtension(value: unknown): value is Extension {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Extension)[marker] === true
  )
}

export class ExtensionScope {
  readonly controller = new AbortController()
  readonly hooks = new Map<string, Set<(value: never) => unknown>>()
  readonly listeners = new Set<{
    type: string
    callback: (event: RuntimeEvent) => void
  }>()
  readonly services = new Map<string, unknown>()
  readonly extensions = new Map<string, Extension>()
  readonly children: ExtensionScope[] = []
  readonly runners: ((context: ExecutionContext) => Promise<unknown>)[] = []
  private readonly cleanups: (() => void | Promise<void>)[] = []
  private readonly commits: (() => void)[] = []
  private closing: Promise<void> | undefined
  committed = false
  replacing = false
  origin?: string
  constructor(
    readonly host: Harness,
    readonly thread?: string,
  ) {}
  get signal() {
    return this.controller.signal
  }
  hook<T>(name: string, callback: (value: T) => unknown): () => void {
    this.signal.throwIfAborted()
    const hooks = this.hooks.get(name) ?? new Set()
    this.hooks.set(name, hooks)
    const fn = callback as (value: never) => unknown
    hooks.add(fn)
    return () => {
      hooks.delete(fn)
    }
  }
  on(type: string, callback: (event: RuntimeEvent) => void): () => void {
    this.signal.throwIfAborted()
    const listener = {type, callback}
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  provide<T>(name: string, value: T): T {
    this.signal.throwIfAborted()
    this.services.set(name, value)
    return value
  }
  get<T>(name: string): T | undefined {
    for (const scope of this.flatten().reverse())
      if (scope.services.has(name)) return scope.services.get(name) as T
    return this.host.service<T>(
      name,
      this.thread,
      this.committed || !this.replacing,
    )
  }
  flatten(): ExtensionScope[] {
    return this.signal.aborted
      ? []
      : [this, ...this.children.flatMap((child) => child.flatten())]
  }
  start(): void {
    for (const scope of this.flatten())
      for (const runner of scope.runners.splice(0)) this.host.run(scope, runner)
  }
  run(callback: (context: ExecutionContext) => Promise<unknown>): void {
    this.signal.throwIfAborted()
    if (this.committed) this.host.run(this, callback)
    else this.runners.push(callback)
  }
  cleanup(callback: () => void | Promise<void>): void {
    this.signal.throwIfAborted()
    this.cleanups.push(callback)
  }
  onCommit(callback: () => void): void {
    this.commits.push(callback)
  }
  async activate(extension: Extension, origin?: string): Promise<void> {
    const existing = this.extensions.get(extension.name)
    if (existing) {
      if (existing !== extension)
        throw new Error(`Conflicting extension: ${extension.name}`)
      return
    }
    if (!this.replacing && this.thread) {
      const installed = this.host.extension(extension.name, this.thread)
      if (installed === extension) return
      if (installed) throw new Error(`Conflicting extension: ${extension.name}`)
    }
    this.extensions.set(extension.name, extension)
    const child = new ExtensionScope(this.host, this.thread)
    child.replacing = this.replacing
    if (origin) child.origin = origin
    child.extensions.set(extension.name, extension)
    this.children.push(child)
    const cleanup = await extension.setup(child)
    if (cleanup) child.cleanup(cleanup)
  }
  commit(): void {
    for (const callback of this.commits) callback()
    this.commits.length = 0
    for (const child of this.children) child.commit()
    this.committed = true
  }
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }
  private async dispose() {
    this.controller.abort(new Error('Extension scope disposed'))
    this.hooks.clear()
    this.listeners.clear()
    this.services.clear()
    this.runners.length = 0
    const errors: unknown[] = []
    for (const child of this.children.splice(0).reverse()) {
      try {
        await child.close()
      } catch (error) {
        errors.push(
          ...(error instanceof AggregateError ? error.errors : [error]),
        )
      }
    }
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(
          ...(error instanceof AggregateError ? error.errors : [error]),
        )
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'Extension cleanup failed')
  }
}
