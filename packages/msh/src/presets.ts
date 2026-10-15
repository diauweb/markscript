import {fileURLToPath} from 'node:url'
import {user} from './conversation.ts'
import {serialize} from './modules.ts'
import type {Shell} from './shell.ts'
import type {Handle, ModulePart, ThreadContext} from './types.ts'
export const promptModule = (name: string): ModulePart => ({
  module: fileURLToPath(import.meta.resolve(`msh/prompts/${name}.ms`)),
})
export const defaultContext = (): ThreadContext => ({
  instructions: [
    promptModule('workspace'),
    {module: fileURLToPath(import.meta.resolve('msh/library/workspace.ms'))},
  ],
  messages: [],
})
/** Compaction policy: summarize separately, retain bindings explicitly, then exec. */
export async function compact(host: Shell, id: Handle = host.root) {
  const before = host.inspect(id, 0)
  if (before.state !== 'idle') throw new Error('Compact an idle thread')
  const data = `History and state:\n\n${fence(serialize(before))}`
  const child = await host.spawn(
    {instructions: [promptModule('compact')], messages: [user(data)]},
    id,
    'compaction',
  )
  await host.wait(child)
  const completed = host.inspect(child, 0)
  if (completed.error) throw new Error(`Compaction failed: ${completed.error}`)
  const summary = completed.messages
    .filter((m) => m.role === 'assistant')
    .at(-1)?.content
  if (!summary) throw new Error('Compaction returned no summary')
  await host.send(child, {control: 'terminate'})
  const current = host.inspect(id, 0)
  if (
    current.generation !== before.generation ||
    current.messages.length !== before.messages.length ||
    current.state !== 'idle' ||
    current.pending
  )
    throw new Error(
      'Thread changed during compaction. Retry from its latest state.',
    )
  const retain = before.abilities
    .map((a) => `export {${a.name}} from ${JSON.stringify(a.module)}`)
    .join('\n\n')
  const extensions = [...new Set(before.extensions.map(({module}) => module))]
    .map((module) => `import ${JSON.stringify(module)}`)
    .join('\n\n')
  const replacement: ThreadContext = {
    instructions: [
      ...before.context.instructions.map(({text}) => ({text})),
      [extensions, retain].filter(Boolean).join('\n\n'),
    ],
    messages: [
      user(
        `Continuation summary:\n\n${summary}\n\nContinue the task described above.\nLive children: ${before.children.join(', ') || 'none'}`,
      ),
    ],
  }
  await host.replaceIdle(id, replacement)
  const after = host.inspect(id, 0)
  if (after.error) throw new Error(after.error)
  return {
    beforeBytes: Buffer.byteLength(serialize(before)),
    afterBytes: Buffer.byteLength(serialize(host.inspect(id, 0).context)),
  }
}
function fence(text: string) {
  const length = Math.max(
    3,
    ...[...text.matchAll(/`+/gu)].map((m) => m[0].length + 1),
  )
  const marker = '`'.repeat(length)
  return `${marker}text\n${text}\n${marker}`
}
