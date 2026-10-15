import {useContext} from './context.ts'
import type {
  Delivery,
  Handle,
  Recipient,
  Target,
  ThreadContext,
} from './core-types.ts'

export type {Handle, Snapshot, State, WaitResult} from './core-types.ts'
export async function spawn(target: Target): Promise<Handle> {
  const c = useContext()
  c.actions++
  return c.host.spawn(target, c.thread)
}
export async function send(
  target: Recipient,
  message: Delivery,
): Promise<void> {
  const c = useContext()
  c.actions++
  await c.host.send(target, message, c.thread)
}
export function inspect(handle: Handle | 'self' = 'self') {
  const c = useContext()
  c.actions++
  return c.host.inspect(handle === 'self' ? c.thread : handle)
}
export async function wait(handle?: Handle) {
  const c = useContext()
  c.actions++
  return c.host.wait(handle, c.thread, c.signal)
}
export async function exec(context: ThreadContext): Promise<never> {
  const c = useContext()
  c.actions++
  return c.host.replace(c.thread, context)
}
