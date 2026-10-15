import {readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import type {Root} from 'mdast'
import {errorMessage} from './context.ts'
import {user} from './conversation.ts'
import {inputDocument} from './input-document.ts'
import {historyMessages, readHistory} from './journal.ts'
import {compact, defaultContext} from './presets.ts'
import {chatCompletions, listModels} from './providers/chat-completions.ts'
import type {Session, SessionStore} from './sessions.ts'
import {type ProfileStore, providerOptions, publicProfile} from './settings.ts'
import type {Shell} from './shell.ts'
import type {AgentSnapshot, ApprovalMode} from './types.ts'
import {type ConversationCard, conversationCards} from './web-content.ts'

export interface SavedConversation {
  title: string
  content: string
  cards?: ConversationCard[]
}

export interface WebUiOptions {
  profiles?: ProfileStore
  sessions?: SessionStore
  session?: Session
  flush?: () => Promise<void>
  initialPrompt?: string
  initialize?: boolean
  port?: number
  assets?: string
  onQuit?: () => void
  onConnect?: () => void
}
export interface WebSnapshot {
  revision: number
  root: string
  threads: AgentSnapshot[]
  cards: Record<string, ConversationCard[]>
  previews: Record<string, string>
  runningTools: Record<string, Record<string, string>>
  workingSince: Record<string, number>
  approvalMode: ApprovalMode
  capabilities: {profiles: boolean; sessions: boolean}
}

async function assetDirectory() {
  let directory = import.meta.dir
  for (;;) {
    const manifest = await Bun.file(path.join(directory, 'package.json'))
      .json()
      .catch(() => undefined)
    if (manifest?.name === 'msh') return path.join(directory, 'web/dist')
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error('Cannot locate msh web assets')
    directory = parent
  }
}

/** The local host owns execution; the browser sends authenticated human controls. */
export async function createWebServer(host: Shell, options: WebUiOptions = {}) {
  const assets = options.assets ?? (await assetDirectory())
  if (!(await Bun.file(path.join(assets, 'index.html')).exists()))
    throw new Error('Build the WebUI with bun run build before starting msh')
  const token = crypto.randomUUID()
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const previews: Record<string, string> = {}
  const runningTools: Record<string, Record<string, string>> = {}
  const workingSince: Record<string, number> = {}
  const selectedProfiles = new Map<string, string>()
  const inputDocuments = new Map<string, Root>()
  const renderInput = (source: string) => {
    let root = inputDocuments.get(source)
    if (!root) {
      root = inputDocument(source)
      inputDocuments.set(source, root)
    }
    return root
  }
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const disconnectApprovals = host.approvals.connect()
  const snapshot = (): WebSnapshot => {
    const threads = host.list().map(({id}) => host.inspect(id, 0))
    for (const thread of threads) {
      if (
        [
          'initializing',
          'running',
          'waiting',
          'stopping',
          'reviewing',
        ].includes(thread.state)
      )
        workingSince[thread.id] ??= Date.now()
      else delete workingSince[thread.id]
    }
    return {
      revision,
      root: host.root,
      threads,
      cards: Object.fromEntries(
        threads.map((thread) => [
          thread.id,
          conversationCards(
            thread,
            previews[thread.id] ?? '',
            runningTools[thread.id] ?? {},
            renderInput,
          ),
        ]),
      ),
      previews,
      runningTools,
      workingSince,
      approvalMode: host.approvals.mode,
      capabilities: {
        profiles: !!options.profiles,
        sessions: !!options.sessions,
      },
    }
  }
  const frame = () =>
    encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
  const publish = () => {
    revision++
    if (!clients.size) return
    const data = frame()
    for (const client of clients) {
      try {
        client.enqueue(data)
      } catch {
        clients.delete(client)
      }
    }
  }
  const unsubscribe = host.subscribe((event) => {
    if (event.type === 'stream')
      previews[event.thread] =
        (previews[event.thread] ?? '') + (event.data as {text: string}).text
    if (
      event.type === 'message' &&
      (event.data as {role: string}).role === 'assistant'
    )
      delete previews[event.thread]
    if (event.type === 'tool.start') {
      const {id, name} = event.data as {id: string; name: string}
      const tools = runningTools[event.thread] ?? {}
      tools[id] = name
      runningTools[event.thread] = tools
    }
    if (event.type === 'tool.end')
      delete runningTools[event.thread]?.[(event.data as {id: string}).id]
    if (
      event.type === 'thread.state' &&
      ['idle', 'dead'].includes((event.data as {state: string}).state)
    ) {
      delete previews[event.thread]
      delete runningTools[event.thread]
    }
    if (!timer && !closed)
      timer = setTimeout(() => {
        timer = undefined
        publish()
      }, 25)
  })
  function thread(value: unknown) {
    if (
      typeof value !== 'string' ||
      !host.list().some((row) => row.id === value)
    )
      throw new Error('Unknown thread')
    return value
  }
  function string(value: unknown, label: string) {
    if (typeof value !== 'string') throw new Error(`${label} must be a string`)
    return value
  }
  async function command(body: Record<string, unknown>) {
    const id = body.thread === undefined ? host.root : thread(body.thread)
    switch (body.action) {
      case 'send': {
        const text = string(body.text, 'Message')
        if (!text.trim()) throw new Error('Write a message first')
        if (host.inspect(id).state === 'dead')
          throw new Error('This thread has ended')
        await host.send(id, user(text))
        break
      }
      case 'new':
        return {thread: await host.spawn(defaultContext())}
      case 'interrupt':
        await host.send(id, {control: 'interrupt'})
        break
      case 'terminate':
        await host.send(id, {control: 'terminate'})
        break
      case 'compact':
        await compact(host, id)
        break
      case 'approval': {
        if (body.decision !== 'approve' && body.decision !== 'deny')
          throw new Error('Unknown approval decision')
        host.approvals.decide(string(body.id, 'Approval ID'), body.decision)
        break
      }
      case 'approval-mode': {
        if (body.mode !== 'auto' && body.mode !== 'manual')
          throw new Error('Unknown approval mode')
        host.approvals.setMode(body.mode)
        break
      }
      case 'profile': {
        if (!options.profiles) throw new Error('Profiles are unavailable')
        const profile = await options.profiles.get(string(body.name, 'Profile'))
        host.setProvider(chatCompletions(providerOptions(profile)), id)
        selectedProfiles.set(id, profile.name)
        break
      }
      case 'model': {
        if (!options.profiles) throw new Error('Profiles are unavailable')
        const profile = await options.profiles.get(
          selectedProfiles.get(id) ?? options.session?.profile,
        )
        host.setProvider(
          chatCompletions(providerOptions(profile, string(body.name, 'Model'))),
          id,
        )
        break
      }
      case 'export': {
        await options.flush?.()
        const filename = string(body.filename ?? '', 'Filename')
        const target = path.resolve(
          host.inspect(id).cwd,
          filename || `msh-history-${Date.now()}.jsonl`,
        )
        const source = /\.(?:md|ms)$/u.test(target)
          ? `${host.inspect(id, 0).conversation}\n`
          : `${host.events.map((event) => JSON.stringify({version: 1, ...event})).join('\n')}\n`
        await writeFile(target, source, {mode: 0o600, flag: 'wx'})
        return {filename: target}
      }
      case 'quit':
        setTimeout(() => options.onQuit?.(), 0)
        break
      default:
        throw new Error('Unknown action')
    }
    return {}
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 0,
    async fetch(request, server) {
      const url = new URL(request.url)
      const origin = server.url.origin
      if (
        request.headers.get('host') !== server.url.host ||
        url.origin !== origin ||
        (request.headers.get('origin') &&
          request.headers.get('origin') !== origin)
      )
        return new Response('Local origin required', {status: 403})
      const headers = {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      }
      const json = (value: unknown, status = 200) =>
        Response.json(value, {status, headers})
      if (url.pathname.startsWith('/api/')) {
        if (
          (request.headers.get('x-msh-token') ??
            (url.pathname === '/api/events'
              ? url.searchParams.get('token')
              : null)) !== token
        )
          return json({error: 'Session token required'}, 403)
        try {
          if (request.method === 'GET' && url.pathname === '/api/events') {
            server.timeout(request, 0)
            let controller:
              | ReadableStreamDefaultController<Uint8Array>
              | undefined
            const remove = () => {
              if (controller) clients.delete(controller)
            }
            const stream = new ReadableStream<Uint8Array>({
              start(value) {
                controller = value
                clients.add(value)
                value.enqueue(frame())
                options.onConnect?.()
              },
              cancel() {
                remove()
                request.signal.removeEventListener('abort', remove)
              },
            })
            request.signal.addEventListener('abort', remove, {once: true})
            return new Response(stream, {
              headers: {...headers, 'Content-Type': 'text/event-stream'},
            })
          }
          if (request.method === 'GET' && url.pathname === '/api/state')
            return json(snapshot())
          if (request.method === 'POST' && url.pathname === '/api/command') {
            const body: unknown = await request.json()
            if (!body || typeof body !== 'object' || Array.isArray(body))
              throw new Error('Expected a command object')
            const result = await command(body as Record<string, unknown>)
            publish()
            return json(result)
          }
          if (request.method === 'GET' && url.pathname === '/api/history') {
            const id = thread(url.searchParams.get('thread'))
            return json(
              host.events.filter(
                (event) => event.thread === id && event.type !== 'stream',
              ),
            )
          }
          if (request.method === 'GET' && url.pathname === '/api/profiles') {
            if (!options.profiles) throw new Error('Profiles are unavailable')
            return json(
              (await options.profiles.read()).profiles.map(publicProfile),
            )
          }
          if (request.method === 'GET' && url.pathname === '/api/models') {
            if (!options.profiles) throw new Error('Profiles are unavailable')
            const id = thread(url.searchParams.get('thread'))
            const profile = await options.profiles.get(
              selectedProfiles.get(id) ?? options.session?.profile,
            )
            return json(await listModels(providerOptions(profile)))
          }
          if (request.method === 'GET' && url.pathname === '/api/sessions') {
            if (!options.sessions)
              throw new Error('Saved sessions are unavailable')
            await options.flush?.()
            return json(await options.sessions.list())
          }
          if (request.method === 'GET' && url.pathname === '/api/saved') {
            if (!options.sessions)
              throw new Error('Saved sessions are unavailable')
            await options.flush?.()
            const session = await options.sessions.find(
              string(url.searchParams.get('id'), 'Session ID'),
            )
            const file = options.sessions.journal(session.id, session.version)
            const messages =
              session.version === 2
                ? historyMessages(await readHistory(file))
                : undefined
            const content = messages
              ? messages
                  .map(
                    ({thread, message}) =>
                      `${thread.slice(0, 8)}  ${message.role}\n${message.document ?? message.content ?? ''}`,
                  )
                  .join('\n\n')
              : await readFile(file, 'utf8')
            const cards = messages
              ? [...new Set(messages.map(({thread}) => thread))].flatMap(
                  (thread) =>
                    conversationCards(
                      {
                        id: thread,
                        messages: messages
                          .filter((entry) => entry.thread === thread)
                          .map((entry) => entry.message),
                      },
                      '',
                      {},
                      renderInput,
                    ).map((card) => ({
                      ...card,
                      title: `${thread.slice(0, 8)} · ${card.title}`,
                    })),
                )
              : undefined
            return json({
              title: session.title,
              content,
              ...(cards ? {cards} : {}),
            } satisfies SavedConversation)
          }
          return json({error: 'Unknown endpoint'}, 404)
        } catch (error) {
          return json({error: errorMessage(error)}, 400)
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method not allowed', {status: 405})
      const file = path.resolve(
        assets,
        `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
      )
      if (!file.startsWith(`${path.resolve(assets)}${path.sep}`))
        return new Response('Not found', {status: 404})
      const asset = Bun.file(file)
      if (!(await asset.exists()))
        return new Response('Not found', {status: 404})
      return new Response(request.method === 'HEAD' ? null : asset, {
        headers: {...headers, 'Content-Type': asset.type},
      })
    },
  })
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      try {
        client.enqueue(encoder.encode(': keepalive\n\n'))
      } catch {
        clients.delete(client)
      }
    }
  }, 15000)
  return {
    url: `${server.url}#${token}`,
    token,
    server,
    publish,
    close() {
      if (closed) return
      closed = true
      if (timer) clearTimeout(timer)
      clearInterval(heartbeat)
      unsubscribe()
      disconnectApprovals()
      for (const client of clients) {
        try {
          client.close()
        } catch {}
      }
      clients.clear()
      server.stop(true)
    },
  }
}

export async function runWebUi(host: Shell, options: WebUiOptions = {}) {
  let quit!: () => void
  let connected!: () => void
  const finished = new Promise<void>((resolve) => {
    quit = resolve
  })
  const ready = new Promise<void>((resolve) => {
    connected = resolve
  })
  const ui = await createWebServer(host, {
    ...options,
    onQuit: quit,
    onConnect: connected,
  })
  console.error(`msh WebUI: ${ui.url}`)
  console.error(
    'Open this local URL in your browser. Press Ctrl+C to close the session.',
  )
  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)
  process.on('SIGHUP', quit)
  try {
    const startup = (async () => {
      const proceed = await Promise.race([
        ready.then(() => true),
        finished.then(() => false),
      ])
      if (!proceed) return
      if (options.initialize) await host.initialize()
      if (options.initialPrompt)
        await host.send(host.root, user(options.initialPrompt))
    })()
    await Promise.race([startup, finished])
    await finished
  } finally {
    process.off('SIGINT', quit)
    process.off('SIGTERM', quit)
    process.off('SIGHUP', quit)
    try {
      await host.close()
    } finally {
      ui.close()
    }
  }
}
