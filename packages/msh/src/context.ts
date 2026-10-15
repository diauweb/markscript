import {AsyncLocalStorage} from 'node:async_hooks'
import type {Handle} from './core-types.ts'
import type {Harness} from './host.ts'
export interface ExecutionContext {
  host: Harness
  thread: Handle
  cwd: string
  signal: AbortSignal
  revision: number
  invocation: string
  span?: string
  parentSpan?: string
  actions: number
  registration?: import('./extensions.ts').ExtensionScope
}
const key = Symbol.for('msh.execution-context')
const globals = globalThis as unknown as Record<symbol, unknown>
globals[key] ??= new AsyncLocalStorage<ExecutionContext>()
export const executionContext = globals[
  key
] as AsyncLocalStorage<ExecutionContext>
export function useContext(): ExecutionContext {
  const context = executionContext.getStore()
  if (!context) throw new Error('msh primitives require a running thread')
  context.signal.throwIfAborted()
  context.host.assertRevision(context.thread, context.revision)
  return context
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
const transfer = Symbol.for('msh.context-transfer')
export class ContextTransfer extends Error {
  readonly [transfer] = true
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      value instanceof Error && (value as ContextTransfer)[transfer] === true
    )
  }
  constructor() {
    super('Context replaced')
  }
}

export async function cancellable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) void work.catch(() => {})
  signal.throwIfAborted()
  let abort: () => void = () => {}
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, {once: true})
      }),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
