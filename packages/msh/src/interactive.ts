import path from 'node:path'
import {errorMessage} from './context.ts'
import {demoProvider} from './demo.ts'
import {HistoryWriter} from './journal.ts'
import {langsmith} from './langsmith.ts'
import {defaultContext} from './presets.ts'
import {chatCompletions} from './providers/chat-completions.ts'
import type {SessionStore} from './sessions.ts'
import {type ProfileStore, providerOptions} from './settings.ts'
import {Shell} from './shell.ts'
export interface ChatOptions {
  profile?: string | undefined
  model?: string | undefined
  prompt?: string | undefined
  title?: string | undefined
  cwd?: string | undefined
  entry?: string | undefined
  input?: string | undefined
  contextBudget?: number | undefined
  maxOutputTokens?: number | undefined
  maxTurns?: number | undefined
  demo?: boolean | undefined
  web?: boolean | undefined
  port?: number | undefined
  approveForMe?: boolean | undefined
  approvalPolicy?: string | undefined
}
export async function chat(
  args: ChatOptions,
  profiles: ProfileStore,
  sessions: SessionStore,
) {
  const interactive =
    args.web ??
    (args.prompt === undefined && process.stdin.isTTY && process.stdout.isTTY)
  const profile = args.demo ? undefined : await profiles.get(args.profile)
  const provider = profile
    ? chatCompletions(providerOptions(profile, args.model ?? profile.model))
    : demoProvider()
  const cwd = path.resolve(args.cwd ?? process.cwd())
  const context = defaultContext()
  if (args.entry)
    context.instructions.push({
      module: path.resolve(cwd, args.entry),
      ...(args.input ? {input: await Bun.file(args.input).json()} : {}),
    })
  const observer = langsmith()
  const host = new Shell({
    cwd,
    provider,
    context,
    approval: {
      mode: args.approveForMe === false ? 'manual' : 'auto',
      ...(args.approvalPolicy
        ? {policy: path.resolve(cwd, args.approvalPolicy)}
        : {}),
    },
    ...(observer ? {observer} : {}),
    ...(args.contextBudget === undefined
      ? {}
      : {contextBudget: args.contextBudget}),
    ...(args.maxOutputTokens === undefined
      ? {}
      : {maxOutputTokens: args.maxOutputTokens}),
    ...(args.maxTurns === undefined ? {} : {maxTurns: args.maxTurns}),
  })
  let writer: HistoryWriter | undefined
  let session: Awaited<ReturnType<SessionStore['allocate']>> | undefined
  try {
    session = await sessions.allocate({
      title: args.title ?? args.prompt?.slice(0, 80) ?? 'MarkScript thread',
      cwd,
      profile: profile?.name ?? 'demo',
      model: provider.identity?.model ?? 'unknown',
      contextBudget: args.contextBudget ?? 0,
      maxOutputTokens: args.maxOutputTokens ?? 8192,
      maxTurns: args.maxTurns ?? 32,
    })
    await sessions.save(session)
    writer = new HistoryWriter(sessions.journal(session.id), host)
    if (interactive) {
      const {runWebUi} = await import('./webui.ts')
      await runWebUi(host, {
        ...(args.port === undefined ? {} : {port: args.port}),
        profiles,
        sessions,
        session,
        initialize: true,
        flush: () => writer?.flush() ?? Promise.resolve(),
        ...(args.prompt ? {initialPrompt: args.prompt} : {}),
      })
    } else {
      await host.initialize()
      const prompt =
        args.prompt ?? (process.stdin.isTTY ? '' : await Bun.stdin.text())
      if (!prompt.trim())
        throw new Error(
          'Supply --prompt TEXT, piped input, or open the WebUI with --web',
        )
      const stop = () => {
        void host.send(host.root, {control: 'interrupt'})
      }
      process.on('SIGINT', stop)
      try {
        const result = await host.turn(prompt)
        if (result.error) throw new Error(result.error)
        const final = result.messages
          .filter((m) => m.role === 'assistant')
          .at(-1)?.content
        if (final) process.stdout.write(`${final}\n`)
      } finally {
        process.off('SIGINT', stop)
      }
    }
  } finally {
    try {
      await host.close()
    } finally {
      await writer?.close()
      if (session)
        await sessions.save({...session, updatedAt: new Date().toISOString()})
    }
  }
}
export {errorMessage}
