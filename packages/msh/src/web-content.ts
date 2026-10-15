import type {Root} from 'mdast'
import type {AgentSnapshot, HistoryMessage, ToolCall} from './types.ts'

export interface ConversationCard {
  key: string
  title: string
  text: string
  rendered?: Root
  details?: string
  references?: string
  tone?: 'error' | 'muted' | 'working'
}
export const threadStatus = (state: AgentSnapshot['state']) =>
  ({
    initializing: 'Starting',
    running: 'Working',
    waiting: 'Waiting',
    idle: 'Ready',
    stopping: 'Stopping',
    reviewing: 'Reviewing',
    approval: 'Needs approval',
    dead: 'Ended',
  })[state]
export const activeThread = (state: AgentSnapshot['state']) =>
  ['initializing', 'running', 'waiting', 'stopping', 'reviewing'].includes(
    state,
  )
export function pretty(source: string) {
  try {
    const value: unknown = JSON.parse(source)
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return source
  }
}
const summary = (source: string) => {
  const text = source.replace(/\s+/gu, ' ').trim()
  return text.length > 96 ? `${text.slice(0, 96)}…` : text
}
function toolCard(
  key: string,
  call: ToolCall,
  result: HistoryMessage | undefined,
  running: boolean,
): ConversationCard {
  const args = pretty(call.function.arguments)
  const output = result ? pretty(result.content ?? 'null') : ''
  let name = call.function.name
  let target = ''
  let error = ''
  try {
    const input = JSON.parse(call.function.arguments)
    if (name === 'call' && typeof input?.name === 'string') name = input.name
    for (const field of [
      'file',
      'path',
      'filename',
      'script',
      'command',
      'cmd',
      'query',
      'url',
      'module',
      'handle',
    ]) {
      if (typeof input?.[field] === 'string') {
        target = summary(input[field])
        break
      }
    }
    const failure = JSON.parse(result?.content ?? 'null')?.error
    if (failure)
      error = summary(
        typeof failure === 'string' ? failure : JSON.stringify(failure),
      )
  } catch {}
  return {
    key,
    title: `${name} · ${result ? (error ? 'Failed' : 'Complete') : running ? 'Running' : 'Pending'}`,
    text: error || target,
    tone: error ? 'error' : running ? 'working' : 'muted',
    details: `Call ${call.id}\n\nArguments\n${args}${result ? `\n\nResult\n${output}` : ''}`,
    references: `${args}\n${output}`,
  }
}
/** Calls are paired in historical order so reused provider IDs remain distinct. */
export function conversationCards(
  state: Pick<AgentSnapshot, 'id' | 'messages' | 'result' | 'error'>,
  preview: string,
  running: Record<string, string>,
  renderInput: (source: string) => Root,
): ConversationCard[] {
  const cards: ConversationCard[] = []
  const results = new Map<ToolCall, HistoryMessage>()
  const pending = new Map<string, ToolCall>()
  const paired = new Set<number>()
  for (const message of state.messages) {
    for (const call of message.tool_calls ?? []) pending.set(call.id, call)
    const call =
      message.role === 'tool'
        ? pending.get(message.tool_call_id ?? '')
        : undefined
    if (call) {
      results.set(call, message)
      paired.add(message.id)
      pending.delete(call.id)
    }
  }
  for (const message of state.messages) {
    const key = `${state.id}-${message.id}`
    if (message.reasoning_content)
      cards.push({
        key: `${key}-reasoning`,
        title: 'Reasoning',
        text: '',
        details: message.reasoning_content,
        tone: 'muted',
      })
    if (
      (message.content || message.rendered?.children.length) &&
      (message.role !== 'tool' || !paired.has(message.id))
    ) {
      const rendered =
        message.rendered ??
        (message.role !== 'tool' && !message.renderError
          ? renderInput(message.content ?? '')
          : undefined)
      cards.push({
        key,
        title:
          message.kind === 'runtime'
            ? 'Runtime feedback'
            : message.role === 'user'
              ? 'You'
              : message.role === 'tool'
                ? 'Tool result'
                : 'Assistant',
        text:
          message.role === 'tool' || rendered
            ? ''
            : message.renderError
              ? `MarkScript diagnostic: ${message.renderError}`
              : (message.content ?? ''),
        ...(rendered ? {rendered} : {}),
        ...(message.renderError ? {tone: 'error' as const} : {}),
        ...(message.role === 'user' && message.kind !== 'runtime'
          ? {}
          : {
              details:
                message.role === 'tool'
                  ? pretty(message.content ?? '')
                  : `Message ${message.id}\n${message.time}\n${message.role}\n\n${message.kind === 'runtime' ? 'Runtime data' : 'MarkScript source'}\n${message.content ?? ''}`,
            }),
        references: message.content ?? '',
      })
    }
    for (const call of message.tool_calls ?? [])
      cards.push(
        toolCard(
          `${key}-${call.id}`,
          call,
          results.get(call),
          !!running[call.id] && !results.has(call),
        ),
      )
  }
  if (state.result !== undefined)
    cards.push({
      key: `${state.id}-result`,
      title: 'Code result',
      text: pretty(JSON.stringify(state.result)),
    })
  if (preview)
    cards.push({
      key: `${state.id}-preview`,
      title: 'Assistant · Writing MarkScript',
      text: preview,
      tone: 'working',
    })
  if (state.error)
    cards.push({
      key: `${state.id}-error`,
      title: 'Error',
      text: state.error,
      tone: 'error',
    })
  return cards
}
