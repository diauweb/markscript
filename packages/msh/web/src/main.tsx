import {Badge} from '@cloudflare/kumo/components/badge'
import {Button} from '@cloudflare/kumo/components/button'
import {Dialog} from '@cloudflare/kumo/components/dialog'
import {Input, InputArea} from '@cloudflare/kumo/components/input'
import {
  ArrowUpIcon,
  CaretDownIcon,
  ChatCircleIcon,
  CommandIcon,
  FolderIcon,
  InfoIcon,
  PlusIcon,
  SidebarIcon,
  StopIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {createRoot} from 'react-dom/client'
import type {RuntimeEvent} from '../../src/core-types.ts'
import type {ApprovalRequest} from '../../src/types.ts'
import {
  activeThread,
  type ConversationCard,
  threadStatus,
} from '../../src/web-content.ts'
import type {SavedConversation, WebSnapshot} from '../../src/webui.ts'
import {Document} from './document.tsx'
import './style.css'

const fragment = location.hash.slice(1)
const token = /^[a-f0-9-]{36}$/u.test(fragment)
  ? fragment
  : (sessionStorage.getItem('msh-token') ?? '')
if (token) sessionStorage.setItem('msh-token', token)
const api = async <T,>(
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(`/api/${endpoint}`, {
    headers: {
      'x-msh-token': token,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    ...(body ? {method: 'POST', body: JSON.stringify(body)} : {}),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? 'Request failed')
  return value as T
}
const Help = `Write\nEnter sends. Shift+Enter or Ctrl+J inserts a newline. Messages queue while a turn is active. Stop or Ctrl+C interrupts the turn. Terminate ends the thread and its children.\n\nNavigate\nCtrl+B toggles threads. Ctrl+K opens commands. F1 opens help. Tab and Shift+Tab move through controls. Arrow keys move through threads, conversation details and menu choices. Enter or Space opens details. Left/Right collapses or expands details. PageUp/PageDown scrolls the focused pane. Escape closes an inspector or dialog and restores focus.\n\nCommands\n/new · /switch ID · /threads · /context · /abilities · /history · /tools · /sessions · /compact · /profile · /model · /export [FILE] · /approvals · /approve-for-me · /terminate · /help · /quit\n\nApprovals\nDeny is initially focused. Arrow keys select a choice; Enter decides. Escape or Close keeps the action pending. Review reopens it. Ctrl+C cancels the pending action.\n\nExport\n.md or .ms exports the selected conversation. Other filenames export the whole run as JSONL. A blank filename creates a new JSONL file in the thread's working directory.\n\nQuit\n/quit, Quit in Commands, or Ctrl+D with an empty composer closes the local session and cleans up active work. Closing the browser leaves the local process available for reconnection. Ctrl+C in the terminal closes the session.`
interface MenuItem {
  name: string
  description: string
  run: () => void | Promise<void>
}
interface Inspector {
  title: string
  mode: 'context' | 'abilities' | 'history' | 'saved' | 'help'
  content?: string
  cards?: ConversationCard[]
}
function App() {
  const [snapshot, setSnapshot] = useState<WebSnapshot>()
  const [connected, setConnected] = useState(false)
  const [ended, setEnded] = useState(false)
  const [selected, setSelected] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [threadsOpen, setThreadsOpen] = useState(
    () => !matchMedia('(max-width: 700px)').matches,
  )
  const [inspector, setInspector] = useState<Inspector>()
  const [history, setHistory] = useState<RuntimeEvent[]>([])
  const [menu, setMenu] = useState<{title: string; items: MenuItem[]}>()
  const [query, setQuery] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [filename, setFilename] = useState('')
  const [notice, setNotice] = useState('')
  const [approvalId, setApprovalId] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [details, setDetails] = useState<Record<string, boolean>>({})
  const [, tick] = useState(0)
  const composer = useRef<HTMLTextAreaElement>(null)
  const transcript = useRef<HTMLElement>(null)
  const inspectorPanel = useRef<HTMLElement>(null)
  const inspectorReturn = useRef<HTMLElement | null>(null)
  const positions = useRef<Record<string, number>>({})
  const dismissed = useRef(new Set<string>())
  const windowRequest = useRef(0)
  const selection = useRef(selected)
  selection.current = selected
  const state = snapshot?.threads.find((row) => row.id === selected)
  const draft = drafts[selected] ?? ''
  const pending = useMemo(
    () =>
      snapshot?.threads
        .flatMap((row) => row.approvals)
        .filter((request) => request.status === 'pending') ?? [],
    [snapshot],
  )
  const approval = pending.find((request) => request.id === approvalId)
  const cards = snapshot?.cards[selected] ?? []
  const label = (id: string) =>
    id === snapshot?.root
      ? 'Main'
      : `${snapshot?.threads.find((row) => row.id === id)?.kind === 'code' ? 'Code thread' : 'Thread'} ${snapshot?.threads.findIndex((row) => row.id === id)}`
  useEffect(() => {
    if (!token) {
      setNotice(
        'Open the complete local URL printed by msh, including its session fragment.',
      )
      return
    }
    const events = new EventSource(
      `/api/events?token=${encodeURIComponent(token)}`,
    )
    events.addEventListener('snapshot', (event) => {
      const value = JSON.parse((event as MessageEvent).data) as WebSnapshot
      setSnapshot((current) =>
        !current || value.revision >= current.revision ? value : current,
      )
      setSelected((current) => current || value.root)
      setConnected(true)
    })
    events.onerror = () => setConnected(false)
    return () => events.close()
  }, [])
  useEffect(() => {
    if (!snapshot?.threads.some((row) => activeThread(row.state))) return
    const timer = setInterval(() => tick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [snapshot?.threads])
  useEffect(() => {
    const next = pending.find((request) => !dismissed.current.has(request.id))
    if (approvalId && pending.some((request) => request.id === approvalId))
      return
    setApprovalId(next?.id ?? '')
    if (next) {
      windowRequest.current++
      setMenu(undefined)
      setExportOpen(false)
    }
  }, [pending, approvalId])
  useEffect(() => {
    if (!approval?.id) return
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[data-decision="deny"]')
        ?.focus(),
    )
    return () => cancelAnimationFrame(frame)
  }, [approval?.id])
  useLayoutEffect(() => {
    if (!snapshot) return
    const view = transcript.current
    if (view) view.scrollTop = positions.current[selected] ?? view.scrollHeight
  }, [selected, snapshot])
  useEffect(() => {
    if (inspector?.mode !== 'history' || !selected || !snapshot) return
    let active = true
    api<RuntimeEvent[]>(`history?thread=${encodeURIComponent(selected)}`)
      .then((value) => {
        if (active) setHistory(value)
      })
      .catch((error) => {
        if (active) setNotice(error.message)
      })
    return () => {
      active = false
    }
  }, [inspector?.mode, selected, snapshot])
  const attempt = async (run: () => void | Promise<void>) => {
    try {
      await run()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }
  const action = <T,>(name: string, args: Record<string, unknown> = {}) =>
    api<T>('command', {
      action: name,
      thread: selected || snapshot?.root,
      ...args,
    })
  const select = (id: string) => {
    windowRequest.current++
    if (transcript.current)
      positions.current[selected] = transcript.current.scrollTop
    setSelected(id)
    if (matchMedia('(max-width: 700px)').matches) setThreadsOpen(false)
    setMenu(undefined)
    requestAnimationFrame(() => composer.current?.focus())
  }
  const showInspector = (
    mode: Inspector['mode'],
    title: string,
    content?: string,
  ) => {
    windowRequest.current++
    if (inspector?.mode === mode) {
      closeInspector()
      return
    }
    if (!inspector)
      inspectorReturn.current = document.activeElement as HTMLElement
    setInspector({mode, title, ...(content === undefined ? {} : {content})})
    requestAnimationFrame(() => inspectorPanel.current?.focus())
  }
  const closeInspector = () => {
    windowRequest.current++
    setInspector(undefined)
    requestAnimationFrame(() =>
      (inspectorReturn.current?.isConnected
        ? inspectorReturn.current
        : composer.current
      )?.focus(),
    )
  }
  const dismissApproval = () => {
    if (approvalId) dismissed.current.add(approvalId)
    setApprovalId('')
  }
  const showMenu = (title: string, items: MenuItem[]) => {
    windowRequest.current++
    setQuery('')
    setMenu({title, items})
  }
  const choices = async (kind: 'profiles' | 'models' | 'sessions') => {
    const request = ++windowRequest.current
    const thread = selected
    const rows = await api<
      | {
          name?: string
          model?: string
          title?: string
          id?: string
          updatedAt?: string
        }[]
      | string[]
    >(kind === 'models' ? `models?thread=${encodeURIComponent(thread)}` : kind)
    if (request !== windowRequest.current || selection.current !== thread)
      return
    showMenu(
      kind === 'profiles'
        ? 'Provider profiles'
        : kind === 'models'
          ? 'Models'
          : 'Saved conversations',
      rows.map((row) => {
        if (typeof row === 'string')
          return {
            name: row,
            description: 'Model',
            run: async () => {
              await action('model', {thread, name: row})
              setNotice(`Using ${row}`)
            },
          }
        if (kind === 'sessions')
          return {
            name: row.title ?? '',
            description: row.updatedAt ?? '',
            run: async () => {
              const request = ++windowRequest.current
              const saved = await api<SavedConversation>(
                `saved?id=${encodeURIComponent(row.id ?? '')}`,
              )
              if (
                request !== windowRequest.current ||
                selection.current !== thread
              )
                return
              setInspector({
                title: saved.title,
                mode: 'saved',
                content: saved.content,
                ...(saved.cards ? {cards: saved.cards} : {}),
              })
            },
          }
        return {
          name: row.name ?? '',
          description: row.model ?? '',
          run: async () => {
            await action('profile', {thread, name: row.name})
            setNotice(`Using ${row.name}`)
          },
        }
      }),
    )
  }
  const quit = async () => {
    await action('quit')
    setEnded(true)
    setConnected(false)
  }
  const command = async (source: string) => {
    const [name, ...args] = source.trim().split(/\s+/u)
    switch (name) {
      case '/new': {
        const result = await action<{thread: string}>('new')
        select(result.thread)
        break
      }
      case '/switch': {
        const matches =
          snapshot?.threads.filter(
            (row) => args[0] && row.id.startsWith(args[0]),
          ) ?? []
        if (matches.length !== 1 || !matches[0])
          throw new Error('Use /switch with one unique thread ID prefix')
        select(matches[0].id)
        break
      }
      case '/threads':
        setThreadsOpen((value) => !value)
        break
      case '/context':
        showInspector('context', 'Context')
        break
      case '/abilities':
        showInspector('abilities', 'Abilities')
        break
      case '/history':
        showInspector('history', 'Event history')
        break
      case '/help':
        showInspector('help', 'Keyboard & help', Help)
        break
      case '/sessions':
        await choices('sessions')
        break
      case '/profile':
        await choices('profiles')
        break
      case '/model':
        await choices('models')
        break
      case '/compact':
        setNotice('Compacting context…')
        await action('compact')
        setNotice('Context replaced')
        break
      case '/terminate':
        await action('terminate')
        break
      case '/tools':
        setExpanded((value) => !value)
        setDetails({})
        break
      case '/approve-for-me':
        await action('approval-mode', {
          mode: snapshot?.approvalMode === 'auto' ? 'manual' : 'auto',
        })
        break
      case '/approvals': {
        const next = pending[0]
        if (next) {
          dismissed.current.delete(next.id)
          setApprovalId(next.id)
        } else setNotice('No approvals pending')
        break
      }
      case '/export':
        if (args.length) {
          const result = await action<{filename: string}>('export', {
            filename: args.join(' '),
          })
          setNotice(`Exported ${result.filename}`)
        } else {
          setFilename('')
          setExportOpen(true)
        }
        break
      case '/quit':
        await quit()
        break
      default:
        throw new Error(`Unknown command: ${name}`)
    }
  }
  const commands = () => {
    if (menu) {
      setMenu(undefined)
      windowRequest.current++
      return
    }
    const items = [
      ['New thread', 'Start a conversation with workspace abilities', '/new'],
      ['Threads', 'Show or hide the thread list · Ctrl+B', '/threads'],
      ['Context', 'Instructions and active conversation', '/context'],
      [
        'Abilities',
        'Native tools and current exported functions',
        '/abilities',
      ],
      ['Event history', 'Recorded execution events', '/history'],
      [
        expanded ? 'Collapse details' : 'Expand details',
        'Arguments, results, reasoning and metadata',
        '/tools',
      ],
      ['Pending approvals', 'Review suspended actions', '/approvals'],
      [
        `Automatic review: ${snapshot?.approvalMode === 'auto' ? 'On' : 'Off'}`,
        'Switch automatic review and manual approval',
        '/approve-for-me',
      ],
    ]
    if (snapshot?.capabilities.sessions)
      items.push([
        'Saved conversations',
        'Read an earlier session',
        '/sessions',
      ])
    if (state?.state === 'idle') {
      items.push([
        'Compact context',
        'Summarize and replace active context',
        '/compact',
      ])
      if (snapshot?.capabilities.profiles)
        items.push(
          ['Provider profile', 'Choose a saved endpoint', '/profile'],
          ['Model', 'Choose a model from the endpoint', '/model'],
        )
    }
    items.push([
      'Export history',
      'Save conversation or complete JSONL run',
      '/export',
    ])
    if (state?.state !== 'dead')
      items.push([
        'Terminate thread',
        'End the thread and its children',
        '/terminate',
      ])
    items.push(
      ['Keyboard & help', 'Shortcuts and commands · F1', '/help'],
      ['Quit', 'Close this local session', '/quit'],
    )
    showMenu(
      'Commands',
      items.map(([name, description, source]) => ({
        name: name ?? '',
        description: description ?? '',
        run: () => command(source ?? ''),
      })),
    )
  }
  const submit = async () => {
    if (!draft.trim() || !connected || approval || menu) return
    const target = selected
    const source = draft
    setDrafts((current) => ({...current, [target]: ''}))
    setNotice('')
    delete positions.current[target]
    try {
      if (source.startsWith('/')) await command(source)
      else await action('send', {thread: target, text: source})
    } catch (error) {
      setDrafts((current) => ({
        ...current,
        [target]: current[target] || source,
      }))
      throw error
    }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey
      if (
        ctrl &&
        event.key.toLowerCase() === 'c' &&
        !window.getSelection()?.toString()
      ) {
        event.preventDefault()
        void attempt(async () => {
          await action('interrupt', {thread: approval?.thread ?? selected})
        })
        return
      }
      if (approval || exportOpen) return
      if (ctrl && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        commands()
      } else if (menu) return
      else if (ctrl && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setThreadsOpen((value) => !value)
      } else if (event.key === 'F1') {
        event.preventDefault()
        showInspector('help', 'Keyboard & help', Help)
      } else if (ctrl && event.key.toLowerCase() === 'd' && !draft) {
        event.preventDefault()
        void attempt(quit)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (inspector) closeInspector()
        else composer.current?.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })
  const navigate = (
    event: React.KeyboardEvent<HTMLElement>,
    selector: string,
  ) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(selector),
    ]
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : Math.max(
              0,
              Math.min(
                buttons.length - 1,
                index + (event.key === 'ArrowUp' ? -1 : 1),
              ),
            )
    event.preventDefault()
    buttons[next]?.focus()
  }
  let inspection: ReactNode
  if (inspector?.mode === 'context')
    inspection = (
      <>
        <h3>Instructions</h3>
        {state?.context.instructions.map((record) => (
          <section key={`${record.module}-${record.text}`}>
            <p className="muted break-all">{record.module}</p>
            {record.rendered ? (
              <Document root={record.rendered} />
            ) : (
              <pre>{record.text}</pre>
            )}
          </section>
        ))}
        <h3>Active conversation</h3>
        <pre>{state?.context.messages.join('\n\n') || 'No messages'}</pre>
      </>
    )
  else if (inspector?.mode === 'abilities')
    inspection = (
      <>
        <h3>Fixed native tools</h3>
        {state?.nativeTools.map((tool) => (
          <section key={tool.function.name}>
            <h4>{tool.function.name}</h4>
            <p>{tool.function.description}</p>
            <pre>{JSON.stringify(tool.function.parameters, null, 2)}</pre>
          </section>
        ))}
        <h3>Exported abilities</h3>
        {state?.abilities.map((ability) => (
          <section key={ability.name}>
            <h4>{ability.name}</h4>
            <Badge variant="secondary">
              {ability.name !== 'call' &&
              state.nativeTools.some(
                (tool) => tool.function.name === ability.name,
              )
                ? 'Native or direct'
                : 'Dispatcher or direct'}
            </Badge>
            <p className="muted break-all">{ability.module}</p>
            <pre>
              {JSON.stringify(ability.definition.function.parameters, null, 2)}
            </pre>
          </section>
        ))}
      </>
    )
  else if (inspector?.mode === 'saved' && inspector.cards)
    inspection = inspector.cards.map((card) => (
      <section key={card.key}>
        <h4>{card.title}</h4>
        {card.rendered && <Document root={card.rendered} />}
        {card.text && <pre>{card.text}</pre>}
        {card.details && (
          <details>
            <summary>Details</summary>
            <pre>{card.details}</pre>
          </details>
        )}
      </section>
    ))
  else
    inspection = (
      <pre>
        {inspector?.mode === 'history'
          ? JSON.stringify(history, null, 2)
          : inspector?.content}
      </pre>
    )
  const references = (source: string) =>
    snapshot?.threads.filter(
      (row) =>
        row.id !== selected &&
        (source.includes(row.id) || source.includes(row.id.slice(0, 8))),
    ) ?? []
  const duration = snapshot?.workingSince[selected]
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">m</span>
          <strong>msh</strong>
          <span className="muted">MarkScript</span>
        </div>
        <div className="header-actions">
          <Badge
            className="connection-status"
            variant={connected ? 'success' : 'secondary'}
          >
            {ended
              ? 'Session closed'
              : connected
                ? 'Local session'
                : 'Reconnecting'}
          </Badge>
          <Button
            variant="ghost"
            aria-label="Toggle threads"
            onClick={() => setThreadsOpen((value) => !value)}
          >
            <SidebarIcon size={18} />
          </Button>
          <Button variant="secondary" onClick={commands}>
            <CommandIcon size={17} />
            Commands<kbd>⌃ K</kbd>
          </Button>
          <Button
            variant="ghost"
            aria-label="Help"
            onClick={() => showInspector('help', 'Keyboard & help', Help)}
          >
            <InfoIcon size={19} />
          </Button>
        </div>
      </header>
      {ended ? (
        <main className="ended">
          <ChatCircleIcon size={36} />
          <h1>Session closed</h1>
          <p>Conversation history is saved. Start msh to open a new session.</p>
        </main>
      ) : (
        <div className="workspace">
          {threadsOpen && (
            <aside className="threads" aria-label="Threads">
              <div className="pane-heading">
                <span>Threads</span>
                <Button
                  variant="ghost"
                  aria-label="New thread"
                  disabled={!connected}
                  onClick={() => void attempt(() => command('/new'))}
                >
                  <PlusIcon size={18} />
                </Button>
              </div>
              <nav
                aria-label="Thread list"
                onKeyDown={(event) => navigate(event, 'button')}
              >
                {snapshot?.threads.map((row) => {
                  let depth = 0
                  let parent = row.parent
                  const seen = new Set([row.id])
                  while (parent && !seen.has(parent)) {
                    seen.add(parent)
                    depth++
                    parent = snapshot.threads.find(
                      (other) => other.id === parent,
                    )?.parent
                  }
                  return (
                    <Button
                      key={row.id}
                      variant="ghost"
                      className={`thread-row ${selected === row.id ? 'selected' : ''}`}
                      style={{paddingLeft: `${12 + Math.min(depth, 4) * 12}px`}}
                      aria-current={selected === row.id ? 'true' : undefined}
                      onClick={() => select(row.id)}
                    >
                      <ChatCircleIcon size={18} />
                      <span>
                        <strong>{label(row.id)}</strong>
                        <span className="thread-meta">
                          {threadStatus(row.state)}
                          {row.pending ? ` · ${row.pending} queued` : ''}
                          <span>{row.id.slice(0, 8)}</span>
                        </span>
                      </span>
                      {activeThread(row.state) && (
                        <span className="working-dot" />
                      )}
                    </Button>
                  )
                })}
              </nav>
              <div className="sidebar-footer">
                <span className="muted">Approval policy</span>
                <Button
                  variant="ghost"
                  disabled={!connected}
                  onClick={() => void attempt(() => command('/approve-for-me'))}
                >
                  Automatic review{' '}
                  <Badge
                    variant={
                      snapshot?.approvalMode === 'auto'
                        ? 'success'
                        : 'secondary'
                    }
                  >
                    {snapshot?.approvalMode === 'auto' ? 'On' : 'Off'}
                  </Badge>
                </Button>
              </div>
            </aside>
          )}
          <main className="conversation">
            <div className="conversation-heading">
              <div>
                <h1>{selected ? label(selected) : 'Connecting…'}</h1>
                <span className="muted path">
                  <FolderIcon size={14} />
                  {state?.cwd}
                </span>
              </div>
              <div className="model">
                <span>{state?.provider?.model ?? 'MarkScript'}</span>
                <Badge
                  variant={
                    state?.state === 'approval' ? 'warning' : 'secondary'
                  }
                >
                  {state ? threadStatus(state.state) : 'Starting'}
                </Badge>
              </div>
            </div>
            <section
              ref={transcript}
              className="transcript"
              aria-label="Conversation"
              onScroll={(event) => {
                const view = event.currentTarget
                if (view.scrollHeight - view.scrollTop - view.clientHeight < 40)
                  delete positions.current[selected]
                else positions.current[selected] = view.scrollTop
              }}
              onKeyDown={(event) => {
                navigate(event, '[data-conversation-control]')
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  const button = document.activeElement as HTMLButtonElement
                  const key = button.dataset.card
                  if (key) {
                    event.preventDefault()
                    setDetails((current) => ({
                      ...current,
                      [key]: event.key === 'ArrowRight',
                    }))
                  }
                }
              }}
            >
              {!cards.length && (
                <div className="welcome">
                  <div className="welcome-icon">
                    <ChatCircleIcon size={28} />
                  </div>
                  <h2>
                    {state?.state === 'dead'
                      ? 'Thread ended'
                      : 'What are we working on?'}
                  </h2>
                  <p>
                    {state?.state === 'dead'
                      ? 'Inspect its history, or start a new thread.'
                      : 'Write a task to work with this local workspace.'}
                  </p>
                </div>
              )}
              {cards.map((card) => (
                <article
                  key={card.key}
                  className={`message ${card.tone ?? ''}`}
                >
                  <div className="message-heading">
                    {card.details !== undefined ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        data-conversation-control
                        data-card={card.key}
                        aria-expanded={details[card.key] ?? expanded}
                        onClick={() =>
                          setDetails((current) => ({
                            ...current,
                            [card.key]: !(current[card.key] ?? expanded),
                          }))
                        }
                      >
                        <CaretDownIcon
                          className={
                            (details[card.key] ?? expanded) ? '' : 'collapsed'
                          }
                          size={14}
                        />
                        {card.title}
                      </Button>
                    ) : (
                      <strong>{card.title}</strong>
                    )}
                  </div>
                  {card.rendered && <Document root={card.rendered} />}
                  {card.text && <pre className="literal">{card.text}</pre>}
                  {card.details !== undefined &&
                    (details[card.key] ?? expanded) && (
                      <pre className="details">{card.details}</pre>
                    )}
                  {references(
                    `${card.text}\n${card.details ?? ''}\n${card.references ?? ''}`,
                  ).map((row) => (
                    <Button
                      key={row.id}
                      variant="secondary"
                      size="sm"
                      data-conversation-control
                      onClick={() => select(row.id)}
                    >
                      Open {label(row.id)} · {row.id.slice(0, 8)}
                    </Button>
                  ))}
                </article>
              ))}
            </section>
            <div className="composer-region">
              {pending.length > 0 && (
                <div className="review-bar">
                  <span>
                    {pending.length} action{pending.length > 1 ? 's' : ''}{' '}
                    awaiting your decision
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => void attempt(() => command('/approvals'))}
                  >
                    Review
                  </Button>
                </div>
              )}
              <div className="composer-box">
                <InputArea
                  ref={composer}
                  aria-label="Message"
                  placeholder={
                    state?.state === 'dead'
                      ? 'Thread ended. Use /new to continue.'
                      : 'Write a message or /command'
                  }
                  value={draft}
                  disabled={!connected}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selected]: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void attempt(submit)
                    } else if (
                      event.ctrlKey &&
                      event.key.toLowerCase() === 'j'
                    ) {
                      event.preventDefault()
                      const input = event.currentTarget
                      const start = input.selectionStart
                      const end = input.selectionEnd
                      setDrafts((current) => ({
                        ...current,
                        [selected]: `${draft.slice(0, start)}\n${draft.slice(end)}`,
                      }))
                      requestAnimationFrame(() =>
                        input.setSelectionRange(start + 1, start + 1),
                      )
                    }
                  }}
                />
                <div className="composer-actions">
                  <span className="muted activity" role="status">
                    {activeThread(state?.state ?? 'idle') && (
                      <span className="working-dot" />
                    )}
                    {state ? threadStatus(state.state) : 'Connecting'}
                    {duration
                      ? ` · ${Math.floor((Date.now() - duration) / 1000)}s`
                      : ''}
                    {state?.pending ? ` · ${state.pending} queued` : ''}
                    {Object.values(snapshot?.runningTools[selected] ?? {}).map(
                      (name) => ` · ${name}`,
                    )}
                  </span>
                  <div>
                    {state && !['idle', 'dead'].includes(state.state) && (
                      <Button
                        variant="secondary"
                        aria-label="Stop turn"
                        disabled={!connected}
                        onClick={() =>
                          void attempt(async () => {
                            await action('interrupt')
                          })
                        }
                      >
                        <StopIcon size={16} />
                        Stop
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      disabled={
                        !connected ||
                        !draft.trim() ||
                        (state?.state === 'dead' && !draft.startsWith('/'))
                      }
                      onClick={() => void attempt(submit)}
                    >
                      <ArrowUpIcon size={16} />
                      {state && activeThread(state.state) ? 'Queue' : 'Send'}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="composer-hint">
                <span>Enter to send · Shift+Enter for a new line</span>
                <span>{selected.slice(0, 8)}</span>
              </div>
            </div>
          </main>
          {inspector && (
            <aside
              ref={inspectorPanel}
              tabIndex={-1}
              className="inspector"
              aria-label={inspector.title}
            >
              <div className="pane-heading">
                <strong>{inspector.title}</strong>
                <Button
                  variant="ghost"
                  aria-label="Close inspector"
                  onClick={closeInspector}
                >
                  <XIcon size={18} />
                </Button>
              </div>
              <div className="inspection">{inspection}</div>
            </aside>
          )}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <Button
            variant="ghost"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <XIcon size={16} />
          </Button>
        </div>
      )}
      <Dialog.Root
        open={!!menu && !approval}
        onOpenChange={(open) => {
          if (!open) {
            windowRequest.current++
            setMenu(undefined)
          }
        }}
      >
        <Dialog size="lg" className="dialog">
          <div className="dialog-heading">
            <Dialog.Title>{menu?.title}</Dialog.Title>
            <Dialog.Close
              render={
                <Button variant="ghost" aria-label="Close commands">
                  <XIcon size={18} />
                </Button>
              }
            />
          </div>
          <Dialog.Description>
            Choose an action. Arrow keys navigate; Enter opens it.
          </Dialog.Description>
          <Input
            aria-label="Filter commands"
            placeholder="Search…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                document
                  .querySelector<HTMLButtonElement>('.menu-items button')
                  ?.focus()
              }
            }}
          />
          <fieldset
            className="menu-items"
            aria-label="Command choices"
            onKeyDown={(event) => navigate(event, 'button')}
          >
            {menu?.items
              .filter((item) =>
                `${item.name} ${item.description}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((item) => (
                <Button
                  variant="ghost"
                  className="menu-item"
                  key={item.name}
                  onClick={() => {
                    setMenu(undefined)
                    void attempt(item.run)
                  }}
                >
                  <strong>{item.name}</strong>
                  <span className="muted">{item.description}</span>
                </Button>
              ))}
            {menu?.items.length === 0 && (
              <p className="muted">Nothing available in this session.</p>
            )}
          </fieldset>
        </Dialog>
      </Dialog.Root>
      <Dialog.Root open={exportOpen && !approval} onOpenChange={setExportOpen}>
        <Dialog size="lg" className="dialog">
          <Dialog.Title>Export history</Dialog.Title>
          <Dialog.Description>
            Save in the selected thread's working directory. Use .md or .ms for
            its conversation, or .jsonl for the whole run.
          </Dialog.Description>
          <Input
            aria-label="Export filename"
            placeholder="msh-history.jsonl"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
          />
          <div className="dialog-actions">
            <Dialog.Close
              render={<Button variant="secondary">Cancel</Button>}
            />
            <Button
              variant="primary"
              onClick={() =>
                void attempt(async () => {
                  const result = await action<{filename: string}>('export', {
                    filename,
                  })
                  setNotice(`Exported ${result.filename}`)
                  setExportOpen(false)
                })
              }
            >
              Export
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
      <ApprovalDialog
        request={approval}
        close={dismissApproval}
        decide={(id, decision) =>
          void attempt(async () => {
            await action('approval', {id, decision})
            dismissed.current.add(id)
            setApprovalId('')
          })
        }
        navigate={navigate}
      />
    </div>
  )
}
function ApprovalDialog({
  request,
  close,
  decide,
  navigate,
}: {
  request: ApprovalRequest | undefined
  close: () => void
  decide: (id: string, decision: 'approve' | 'deny') => void
  navigate: (event: React.KeyboardEvent<HTMLElement>, selector: string) => void
}) {
  return (
    <Dialog.Root
      open={!!request}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <Dialog size="xl" className="dialog approval-dialog">
        <div className="dialog-heading">
          <Dialog.Title>
            {request?.presentation?.title ?? 'Approval required'}
          </Dialog.Title>
          <Dialog.Close
            render={
              <Button variant="ghost" aria-label="Close approval">
                <XIcon size={18} />
              </Button>
            }
          />
        </div>
        <Dialog.Description>{request?.reason}</Dialog.Description>
        <div className="approval-body">
          {request?.presentation && (
            <Document root={request.presentation.body} />
          )}
        </div>
        <fieldset
          className="dialog-actions"
          aria-label="Approval choices"
          onKeyDown={(event) => navigate(event, 'button')}
        >
          {request?.presentation?.choices.map((choice) => (
            <Button
              key={choice.value}
              data-decision={choice.value}
              variant={choice.value === 'deny' ? 'secondary' : 'primary'}
              onClick={() => decide(request.id, choice.value)}
            >
              {choice.label}
            </Button>
          ))}
        </fieldset>
      </Dialog>
    </Dialog.Root>
  )
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
