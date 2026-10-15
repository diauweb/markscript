#!/usr/bin/env bun
import {BunServices} from '@effect/platform-bun'
import {Effect, Option, Redacted} from 'effect'
import {Argument, CliError, Command, Flag, Prompt} from 'effect/unstable/cli'
import {chat} from './interactive.ts'
import {historyDocument, readHistory} from './journal.ts'
import {listModels} from './providers/chat-completions.ts'
import {deepseekPreset} from './providers/presets.ts'
import {SessionStore} from './sessions.ts'
import {
  type Profile,
  ProfileStore,
  providerOptions,
  publicProfile,
  validateProfile,
} from './settings.ts'

const profiles = new ProfileStore()
const sessions = new SessionStore()
const task = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new CliError.UserError({cause}),
  })
const optional = (name: string, description: string) =>
  Flag.string(name).pipe(
    Flag.withDescription(description),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  )
const positional = (name: string) =>
  Argument.string(name).pipe(
    Argument.optional,
    Argument.map(Option.getOrUndefined),
  )
const boolean = (name: string) =>
  Flag.boolean(name).pipe(Flag.withDefault(false))
const json = boolean('json').pipe(
  Flag.withDescription('Print machine-readable JSON'),
)
const profileFlag = optional(
  'profile',
  'Saved provider profile (defaults to the selected profile)',
)
const modelFlag = optional('model', 'Model ID supplied by the provider')

async function question(message: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error(
      `${message}: supply the corresponding command flag in noninteractive mode`,
    )
  return Effect.runPromise(
    Prompt.text({message}).pipe(Effect.provide(BunServices.layer)),
  )
}

const login = Command.make(
  'login',
  {
    name: positional('name'),
    preset: Flag.choice('preset', ['deepseek', 'custom']).pipe(
      Flag.optional,
      Flag.map(Option.getOrUndefined),
    ),
    baseURL: optional(
      'base-url',
      'Chat Completions base URL, including /v1 when required',
    ),
    model: modelFlag,
    keyEnv: optional(
      'api-key-env',
      'Read the key from this environment variable on each run',
    ),
    keyStdin: boolean('key-stdin').pipe(
      Flag.withDescription('Read and save a key from stdin'),
    ),
    noAuth: boolean('no-auth').pipe(
      Flag.withDescription(
        'Configure an endpoint that requires no authentication',
      ),
    ),
    noVerify: boolean('no-verify').pipe(
      Flag.withDescription(
        'Skip GET /models for endpoints without model discovery',
      ),
    ),
  },
  (args) =>
    task(async () => {
      const name = args.name ?? 'deepseek'
      const existing = (await profiles.read()).profiles.find(
        (profile) => profile.name === name,
      )
      const preset =
        args.preset ??
        (args.baseURL
          ? 'custom'
          : (existing?.preset ?? (name === 'deepseek' ? 'deepseek' : 'custom')))
      const baseURL =
        args.baseURL ??
        existing?.baseURL ??
        (preset === 'deepseek'
          ? deepseekPreset.baseURL
          : await question('Provider base URL'))
      const model =
        args.model ??
        existing?.model ??
        (preset === 'deepseek'
          ? deepseekPreset.model
          : await question('Model ID'))
      if (
        [args.keyEnv !== undefined, args.keyStdin, args.noAuth].filter(Boolean)
          .length > 1
      )
        throw new Error('Choose one of --api-key-env, --key-stdin or --no-auth')
      let auth: Profile['auth']
      if (args.noAuth) auth = {kind: 'none'}
      else if (args.keyEnv) auth = {kind: 'env', variable: args.keyEnv}
      else if (args.keyStdin) {
        if (process.stdin.isTTY)
          throw new Error(
            'Pipe the API key to --key-stdin, or omit it for a masked prompt',
          )
        auth = {kind: 'key', value: (await Bun.stdin.text()).trim()}
      } else {
        if (!process.stdin.isTTY)
          throw new Error(
            'Use --api-key-env NAME or pipe a key with --key-stdin to log in noninteractively',
          )
        const key = await Effect.runPromise(
          Prompt.password({message: `API key for ${name}`}).pipe(
            Effect.provide(BunServices.layer),
          ),
        )
        auth = {kind: 'key', value: Redacted.value(key).trim()}
      }
      const profile = validateProfile({name, preset, baseURL, model, auth})
      const options = providerOptions(profile)
      if (!args.noVerify) {
        console.error('Verifying credentials and model with GET /models…')
        const available = await listModels(options)
        if (!available.includes(model))
          throw new Error(
            `Model '${model}' is unavailable. Choose --model from: ${available.join(', ') || '(no models returned)'}`,
          )
      }
      await profiles.save(profile)
      console.error(
        `Saved profile ${name} (${model})${args.noVerify ? '; verification skipped' : '; credentials verified'}.`,
      )
      console.error(`Start with msh chat --profile ${name}.`)
    }),
).pipe(
  Command.withDescription(
    'Save an API-key profile; prompts hide the key and GET /models verifies access',
  ),
)

const logout = Command.make('logout', {name: positional('name')}, (args) =>
  task(async () => {
    console.error(
      `Logged out of ${await profiles.logout(args.name)}. Saved sessions remain available.`,
    )
  }),
).pipe(Command.withDescription('Remove saved authentication for a profile'))

const showProfiles = (machine: boolean) =>
  task(async () => {
    const config = await profiles.read()
    const rows = config.profiles.map((profile) => ({
      ...publicProfile(profile),
      default: profile.name === config.defaultProfile,
    }))
    if (machine) console.log(JSON.stringify(rows))
    else if (!rows.length) console.log('No profiles. Run msh login deepseek.')
    else
      for (const row of rows)
        console.log(
          `${row.default ? '*' : ' '} ${row.name}\t${row.model}\t${row.authentication}\t${row.baseURL}`,
        )
  })
const profileCommands = Command.make('profiles', {json}, ({json}) =>
  showProfiles(json),
).pipe(
  Command.withDescription(
    'List provider profiles without exposing credentials',
  ),
  Command.withSubcommands([
    Command.make('use', {name: Argument.string('name')}, ({name}) =>
      task(async () => {
        await profiles.use(name)
        console.error(`Default profile: ${name}`)
      }),
    ).pipe(Command.withDescription('Choose the default profile for new chats')),
  ]),
)
const models = Command.make(
  'models',
  {profile: profileFlag, json},
  ({profile, json}) =>
    task(async () => {
      const available = await listModels(
        providerOptions(await profiles.get(profile)),
      )
      console.log(json ? JSON.stringify(available) : available.join('\n'))
    }),
).pipe(Command.withDescription('List models from the configured endpoint'))

const showSessions = (machine: boolean) =>
  task(async () => {
    const rows = await sessions.list()
    if (machine) console.log(JSON.stringify(rows))
    else if (!rows.length)
      console.log('No saved sessions. Start with msh chat.')
    else
      for (const row of rows)
        console.log(
          `${row.id.slice(0, 8)}\t${row.updatedAt}\t${row.profile}/${row.model}\t${row.title.replace(/[\r\n\t]/gu, ' ')}`,
        )
  })
const sessionCommands = Command.make('sessions', {json}, ({json}) =>
  showSessions(json),
).pipe(
  Command.withDescription(
    'List saved sessions, newest first; IDs accept unique prefixes',
  ),
  Command.withSubcommands([
    Command.make('show', {id: positional('id'), json}, ({id, json}) =>
      task(async () => {
        const journal = await sessions.find(id)
        const filename = sessions.journal(journal.id, journal.version)
        const history =
          journal.version === 2
            ? await readHistory(filename)
            : await Bun.file(filename).text()
        if (json)
          console.log(JSON.stringify({session: journal, history}, null, 2))
        else {
          console.log(`${journal.title} · ${journal.id}\n${journal.cwd}\n`)
          if (typeof history === 'string') process.stdout.write(history)
          else
            for (const event of history) {
              if (event.type === 'message') {
                const message = event.data as {
                  role: string
                  content: string | null
                  document?: string
                }
                console.log(
                  `[${event.thread.slice(0, 8)}] ${message.role}\n${message.document ?? message.content ?? ''}\n`,
                )
              } else if (event.type === 'error' || event.type === 'exec')
                console.log(
                  `[${event.thread.slice(0, 8)}] ${event.type}: ${JSON.stringify(event.data)}`,
                )
            }
        }
      }),
    ).pipe(
      Command.withDescription('Read a saved conversation without executing it'),
    ),
    Command.make(
      'export',
      {
        id: positional('id'),
        markdown: boolean('markdown'),
        thread: optional(
          'thread',
          'Thread handle for Markdown export; defaults to root',
        ),
      },
      ({id, markdown, thread}) =>
        task(async () => {
          const journal = await sessions.find(id)
          if (markdown && journal.version === 2) {
            process.stdout.write(
              `${historyDocument(await readHistory(sessions.journal(journal.id, journal.version)), thread)}\n`,
            )
            return
          }
          process.stdout.write(
            await Bun.file(
              sessions.journal(journal.id, journal.version),
            ).text(),
          )
        }),
    ).pipe(Command.withDescription('Export saved inert history to stdout')),
  ]),
)

const chatFlags = {
  web: Flag.boolean('web').pipe(
    Flag.optional,
    Flag.map(Option.getOrUndefined),
    Flag.withDescription(
      'Open the local WebUI; --no-web selects document output',
    ),
  ),
  port: Flag.integer('port').pipe(
    Flag.optional,
    Flag.map(Option.getOrUndefined),
    Flag.withDescription('Loopback HTTP port (default: an available port)'),
  ),
  approveForMe: Flag.boolean('approve-for-me').pipe(
    Flag.withDefault(true),
    Flag.withDescription(
      'Automatically review actions; --no-approve-for-me selects manual approval',
    ),
  ),
  approvalPolicy: optional(
    'approval-policy',
    'Trusted MarkScript module exporting beforeAction(action, services)',
  ),
  profile: profileFlag,
  model: modelFlag,
  prompt: optional(
    'prompt',
    'Run one turn; otherwise accept piped input or open the local WebUI',
  ).pipe(Flag.withAlias('p')),
  title: optional('title', 'Title shown in the saved session list'),
  contextBudget: Flag.integer('context-budget').pipe(
    Flag.withDescription('Context budget in UTF-8 bytes plus output reserve'),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  ),
  maxOutputTokens: Flag.integer('max-output-tokens').pipe(
    Flag.withDescription('Output token limit (default: 8192)'),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  ),
  maxTurns: Flag.integer('max-turns').pipe(
    Flag.withDescription('Maximum model requests per turn (default: 32)'),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  ),
}
const start = (args: Parameters<typeof chat>[0]) =>
  task(() => chat(args, profiles, sessions))
const chatCommand = Command.make(
  'chat',
  {
    ...chatFlags,
    entry: positional('entry.ms'),
    input: optional(
      'input',
      'JSON file passed to the entry MarkScript as native input',
    ),
    cwd: optional(
      'cwd',
      'Working directory for threads and inline MarkScript imports',
    ),
  },
  start,
).pipe(
  Command.withDescription(
    'Start V1 threads with workspace abilities and saved history; optionally import a MarkScript context',
  ),
)
const demoCommand = Command.make(
  'demo',
  {web: boolean('web'), port: chatFlags.port},
  ({web, port}) =>
    start({
      demo: true,
      web,
      port,
      prompt: 'Calculate 20 + 22 using an emitted arithmetic tool.',
    }),
).pipe(
  Command.withDescription(
    'Run a deterministic local V1 demo; --web opens the local WebUI',
  ),
)

const app = Command.make('msh', {}, () => start({})).pipe(
  Command.withDescription(
    'MarkScript agent shell. Login, run threads, and inspect saved history. Run msh COMMAND --help for options.',
  ),
  Command.withSubcommands([
    login,
    logout,
    profileCommands,
    models,
    chatCommand,
    sessionCommands,
    demoCommand,
  ]),
)

const program = Command.runWith(app, {version: '0.1.0'})(
  process.argv.slice(2),
).pipe(
  Effect.provide(BunServices.layer),
  Effect.catch((error) =>
    Effect.sync(() => {
      process.exitCode =
        error._tag === 'ShowHelp' && error.errors.length === 0 ? 0 : 1
    }),
  ),
)
await Effect.runPromise(program)
