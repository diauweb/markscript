import {parseMarkscript} from '@markscript/compiler'
import {fromMarkdown} from 'mdast-util-from-markdown'
import type {Message, ToolCall} from './types.ts'

const userStart = /^(:{3,})user[ \t]*$/u
const protocolFences = new Set(['tool-call', 'tool-result', 'reasoning'])

/** Quote literal input, including braces, imports, and nested role delimiters. */
export function user(text: string): string {
  const size = Math.max(
    3,
    ...[...text.matchAll(/^:+/gmu)].map((m) => m[0].length + 1),
  )
  const marker = ':'.repeat(size)
  return `${marker}user\n${text}\n${marker}`
}

function fence(language: string, text: string, meta = ''): string {
  const size = Math.max(
    3,
    ...[...text.matchAll(/`+/gu)].map((m) => m[0].length + 1),
  )
  const marker = '`'.repeat(size)
  return `${marker}${language}${meta ? ` ${meta}` : ''}\n${text}\n${marker}`
}

function metadata(text: string | null | undefined, allowed: string[]) {
  const result: Record<string, string> = {}
  let rest = text?.trim() ?? ''
  while (rest) {
    const match = /^([\w-]+)=("(?:[^"\\]|\\.)*"|[^\s"]+)(?:\s+|$)/u.exec(rest)
    if (!match?.[1] || !match[2])
      throw new Error(`Invalid fence metadata: ${rest}`)
    const [, key, value] = match
    if (!allowed.includes(key) || key in result)
      throw new Error(`Unexpected fence attribute: ${key}`)
    result[key] = value.startsWith('"') ? JSON.parse(value) : value
    rest = rest.slice(match[0].length)
  }
  for (const key of allowed)
    if (!result[key]) throw new Error(`Fence requires ${key}`)
  return result
}

function toolCall(meta: string | null | undefined, body: string): ToolCall {
  const {id, name} = metadata(meta, ['id', 'name'])
  const args: unknown = JSON.parse(body)
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('Tool-call arguments must be a JSON object')
  return {
    id: id as string,
    type: 'function',
    function: {name: name as string, arguments: body.trim()},
  }
}

function assistant(messages: Message[]): Message {
  const previous = messages.at(-1)
  if (previous?.role === 'assistant') return previous
  const message: Message = {role: 'assistant', content: null}
  messages.push(message)
  return message
}

function closedFence(source: string) {
  const lines = source.split(/\r?\n/u)
  const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(lines[0] ?? '')?.[1]
  if (
    !marker ||
    lines.length < 2 ||
    !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`, 'u').test(
      lines.at(-1) ?? '',
    )
  )
    throw new Error('Protocol fences require a closing delimiter')
}

/** Read conversation data without compiling or evaluating its MarkScript. */
export function parseConversation(source: string): Message[] {
  const messages: Message[] = []
  let rest = source
  const prose = (text: string) => {
    if (!text.trim()) return
    const message = assistant(messages)
    message.content = [message.content, text.trim()]
      .filter(Boolean)
      .join('\n\n')
  }
  while (rest) {
    const userNode = fromMarkdown(rest).children.find((item) => {
      if (item.type !== 'paragraph') return false
      const start = item.position?.start.offset ?? 0
      return userStart.test(rest.slice(start).split(/\r?\n/u)[0] ?? '')
    })
    const prefix = rest.slice(
      0,
      userNode?.position?.start.offset ?? rest.length,
    )
    // Respect ESM/string boundaries in assistant source, while literal user
    // bodies and invalid historical snippets never need to parse as JS.
    const tree =
      parseMarkscript(prefix, 'conversation.ms').tree ?? fromMarkdown(prefix)
    const node =
      tree.children?.find(
        (item) => item.type === 'code' && protocolFences.has(item.lang ?? ''),
      ) ?? userNode
    if (!node) {
      prose(rest)
      break
    }
    const start = node.position?.start.offset ?? 0
    let end = node.position?.end.offset ?? rest.length
    prose(rest.slice(0, start))
    if (node.type === 'code') {
      closedFence(rest.slice(start, end))
      if (node.lang === 'tool-call') {
        const message = assistant(messages)
        message.tool_calls ??= []
        message.tool_calls.push(toolCall(node.meta, node.value ?? ''))
      } else if (node.lang === 'tool-result') {
        const {id} = metadata(node.meta, ['id'])
        JSON.parse(node.value ?? '')
        messages.push({
          role: 'tool',
          tool_call_id: id as string,
          content: node.value?.trim() ?? '',
        })
      } else {
        if (node.meta?.trim())
          throw new Error('Reasoning fences take no attributes')
        assistant(messages).reasoning_content = node.value ?? ''
      }
    } else {
      const openingEnd = rest.indexOf('\n', start)
      if (openingEnd < 0) throw new Error('Unclosed user directive')
      const opening = rest.slice(start, openingEnd).trimEnd()
      const marker = userStart.exec(opening)?.[1]
      const closing = new RegExp(`^${marker}[ \\t]*\\r?$`, 'gm')
      closing.lastIndex = openingEnd + 1
      const match = closing.exec(rest)
      if (!match) throw new Error('Unclosed user directive')
      let content = rest.slice(openingEnd + 1, match.index)
      content = content.replace(/\r?\n$/u, '')
      messages.push({role: 'user', content})
      end = match.index + match[0].length
    }
    rest = rest.slice(end).replace(/^\r?\n/u, '')
  }
  return messages
}

export function conversation(messages: readonly Message[]): string {
  return messages
    .map((message) => {
      if (message.role === 'system')
        throw new Error('Instructions belong in instructions')
      if (message.role === 'user') return user(message.content ?? '')
      if (message.role === 'tool') {
        let body = message.content ?? 'null'
        try {
          JSON.parse(body)
        } catch {
          body = JSON.stringify(body)
        }
        return fence(
          'tool-result',
          body,
          `id=${JSON.stringify(message.tool_call_id)}`,
        )
      }
      return [
        message.reasoning_content
          ? fence('reasoning', message.reasoning_content)
          : '',
        message.content ?? '',
        ...(message.tool_calls ?? []).map((call) =>
          fence(
            'tool-call',
            call.function.arguments,
            `id=${JSON.stringify(call.id)} name=${JSON.stringify(call.function.name)}`,
          ),
        ),
      ]
        .filter(Boolean)
        .join('\n\n')
    })
    .join('\n\n')
}

/** Validate complete history; partially completed calls are only live runtime state. */
export function validateConversation(messages: readonly Message[]) {
  const ids = new Set<string>()
  const pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.tool_call_id || !pending.delete(message.tool_call_id))
        throw new Error(`Unmatched tool result: ${message.tool_call_id}`)
      continue
    }
    if (pending.size)
      throw new Error(`Missing tool results: ${[...pending].join(', ')}`)
    for (const call of message.tool_calls ?? []) {
      if (ids.has(call.id))
        throw new Error(`Duplicate tool-call id: ${call.id}`)
      ids.add(call.id)
      pending.add(call.id)
    }
  }
  if (pending.size)
    throw new Error(`Missing tool results: ${[...pending].join(', ')}`)
}

/** Lower explicit action fences in place, so expressions and calls retain source order. */
export function emission(message: Message): {
  message: Message
  source: string
  native: ToolCall[]
} {
  const source = message.content ?? ''
  const parsed = parseMarkscript(source, 'emission.ms')
  if (!parsed.tree)
    throw new Error(parsed.diagnostics.map((d) => d.message).join('\n'))
  const calls: ToolCall[] = []
  const replacements: {start: number; end: number; text: string}[] = []
  const alias = `__msh_${crypto.randomUUID().replaceAll('-', '')}`
  for (const node of parsed.tree.children ?? []) {
    if (node.type === 'containerDirective' && node.name === 'user')
      throw new Error('Live assistant output cannot supply a user message')
    if (node.type !== 'code' || !protocolFences.has(node.lang ?? '')) continue
    if (node.lang !== 'tool-call')
      throw new Error(
        'Live observations and reasoning are supplied by the runtime/provider',
      )
    const call = toolCall(node.meta, node.value ?? '')
    calls.push(call)
    const start = node.position?.start.offset ?? 0
    const end = node.position?.end.offset ?? start
    closedFence(source.slice(start, end))
    const lines = source.slice(start, end).split('\n').length
    replacements.push({
      start,
      end,
      text: `{${alias}(${JSON.stringify(call)}).then(() => '')}${'\n'.repeat(lines - 1)}`,
    })
  }
  let executable = source
  let content = source
  for (const item of [...replacements].reverse()) {
    executable =
      executable.slice(0, item.start) + item.text + executable.slice(item.end)
    content = content.slice(0, item.start) + content.slice(item.end)
  }
  if (replacements.length)
    executable = `import {executeTool as ${alias}} from 'msh/agent'\n\n${executable}`
  const all = [...calls, ...(message.tool_calls ?? [])]
  const ids = new Set(all.map((call) => call.id))
  if (ids.size !== all.length)
    throw new Error('Duplicate tool-call id in emission')
  return {
    source: executable,
    message: {
      ...message,
      content: content.trim() || null,
      ...(all.length ? {tool_calls: all} : {}),
    },
    native: message.tool_calls ?? [],
  }
}
