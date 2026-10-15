import {appendFile, readFile} from 'node:fs/promises'
import {conversation} from './conversation.ts'
import {serialize} from './modules.ts'
import type {HistoryMessage, Message, RuntimeEvent} from './types.ts'
export class HistoryWriter {
  private pending = Promise.resolve()
  private failure: unknown
  private readonly unsubscribe: () => void
  constructor(
    readonly filename: string,
    host: {
      events: RuntimeEvent[]
      subscribe(listener: (event: RuntimeEvent) => void): () => void
    },
  ) {
    const append = (event: RuntimeEvent) => {
      const line = `${serialize({version: 1, ...event})}\n`
      this.pending = this.pending
        .then(() => appendFile(filename, line, {mode: 0o600}))
        .catch((error: unknown) => {
          this.failure = error
        })
    }
    for (const event of host.events) append(event)
    this.unsubscribe = host.subscribe(append)
  }
  async flush() {
    await this.pending
    if (this.failure) throw this.failure
  }
  async close() {
    this.unsubscribe()
    await this.flush()
  }
}
/** Read inert event records. Historical modules are never imported by this reader. */
export async function readHistory(filename: string): Promise<RuntimeEvent[]> {
  const text = await readFile(filename, 'utf8')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      const event = JSON.parse(line)
      if (
        event.version !== 1 ||
        event.seq !== index + 1 ||
        typeof event.thread !== 'string' ||
        typeof event.type !== 'string'
      )
        throw new Error(`Invalid history record at line ${index + 1}`)
      return event as RuntimeEvent
    })
}

export function historyMessages(events: RuntimeEvent[]) {
  const messages = new Map<string, {thread: string; message: HistoryMessage}>()
  for (const event of events) {
    if (event.type === 'message') {
      const message = structuredClone(event.data as HistoryMessage)
      messages.set(`${event.thread}:${message.id}`, {
        thread: event.thread,
        message,
      })
    } else if (event.type === 'message.rendered') {
      const update = event.data as Pick<
        HistoryMessage,
        'id' | 'rendered' | 'renderError'
      >
      const entry = messages.get(`${event.thread}:${update.id}`)
      if (entry) Object.assign(entry.message, update)
    }
  }
  return [...messages.values()]
}

/** Export one thread as inert conversation source; default to the root thread. */
export function historyDocument(
  events: RuntimeEvent[],
  thread = events[0]?.thread,
): string {
  if (!thread || !events.some((event) => event.thread === thread))
    throw new Error('Unknown history thread')
  return events
    .filter((event) => event.thread === thread && event.type === 'message')
    .map((event) => {
      const message = event.data as Message & {document?: string}
      return message.document ?? conversation([message])
    })
    .join('\n\n')
}
