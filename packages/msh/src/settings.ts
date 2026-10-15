import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import path from 'node:path'
import {Schema} from 'effect'
import {
  type ChatCompletionsOptions,
  endpoint,
} from './providers/chat-completions.ts'
import {deepseekPreset} from './providers/presets.ts'
import {isMissing, lease, privateDirectory, writeJson} from './storage.ts'

const profileSchema = Schema.Struct({
  name: Schema.String,
  preset: Schema.Literals(['deepseek', 'custom']),
  baseURL: Schema.String,
  model: Schema.String,
  auth: Schema.Union([
    Schema.Null,
    Schema.Struct({kind: Schema.Literal('key'), value: Schema.String}),
    Schema.Struct({kind: Schema.Literal('env'), variable: Schema.String}),
    Schema.Struct({kind: Schema.Literal('none')}),
  ]),
})
const configSchema = Schema.Struct({
  version: Schema.Literal(1),
  defaultProfile: Schema.NullOr(Schema.String),
  profiles: Schema.Array(profileSchema),
})
export type Profile = typeof profileSchema.Type
export type Settings = typeof configSchema.Type

export function locations(env: NodeJS.ProcessEnv = process.env) {
  const base = env.MSH_HOME ? path.resolve(env.MSH_HOME) : undefined
  return {
    config: base
      ? path.join(base, 'config')
      : path.join(
          env.XDG_CONFIG_HOME || path.join(homedir(), '.config'),
          'msh',
        ),
    sessions: base
      ? path.join(base, 'sessions')
      : path.join(
          env.XDG_DATA_HOME || path.join(homedir(), '.local/share'),
          'msh',
          'sessions',
        ),
  }
}

export function validateProfile(profile: Profile): Profile {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(profile.name))
    throw new Error(
      'Profile names use 1–64 letters, numbers, underscores or hyphens',
    )
  endpoint(profile.baseURL, 'models')
  if (!profile.model.trim()) throw new Error('A model is required')
  if (
    profile.auth?.kind === 'key' &&
    (!profile.auth.value.trim() || /\s/u.test(profile.auth.value))
  )
    throw new Error('The API key must be nonempty and contain no whitespace')
  if (
    profile.auth?.kind === 'env' &&
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(profile.auth.variable)
  )
    throw new Error('Invalid API key environment variable name')
  return profile
}

export class ProfileStore {
  readonly filename: string
  constructor(readonly directory = locations().config) {
    this.filename = path.join(directory, 'config.json')
  }

  async read(): Promise<Settings> {
    const source = await readFile(this.filename, 'utf8').catch(
      (error: unknown) => {
        if (isMissing(error)) return undefined
        throw error
      },
    )
    if (source === undefined)
      return {version: 1, defaultProfile: null, profiles: []}
    try {
      const config = Schema.decodeUnknownSync(configSchema)(JSON.parse(source))
      for (const profile of config.profiles) validateProfile(profile)
      if (
        new Set(config.profiles.map((profile) => profile.name)).size !==
        config.profiles.length
      )
        throw new Error('Duplicate profile')
      return config
    } catch {
      throw new Error(`Invalid msh configuration: ${this.filename}`)
    }
  }

  private async update(
    change: (settings: Settings) => Settings,
  ): Promise<void> {
    await privateDirectory(this.directory)
    const lock = await lease(this.filename)
    try {
      const next = change(await this.read())
      lock.check()
      await writeJson(this.filename, next)
    } finally {
      await lock.close()
    }
  }

  save(profile: Profile): Promise<void> {
    validateProfile(profile)
    return this.update((settings) => ({
      ...settings,
      defaultProfile: settings.defaultProfile ?? profile.name,
      profiles: [
        ...settings.profiles.filter((item) => item.name !== profile.name),
        profile,
      ],
    }))
  }

  async get(name?: string): Promise<Profile> {
    const settings = await this.read()
    const selected = name ?? settings.defaultProfile
    const profile = settings.profiles.find((item) => item.name === selected)
    if (!profile)
      throw new Error(
        selected
          ? `Unknown profile '${selected}'. Run msh login ${selected}.`
          : 'Login required. Run msh login deepseek, or msh login NAME --base-url URL --model MODEL.',
      )
    return profile
  }

  async use(name: string): Promise<void> {
    await this.update((settings) => {
      if (!settings.profiles.some((profile) => profile.name === name))
        throw new Error(`Unknown profile '${name}'`)
      return {...settings, defaultProfile: name}
    })
  }

  async logout(name?: string): Promise<string> {
    const profile = await this.get(name)
    await this.update((settings) => ({
      ...settings,
      profiles: settings.profiles.map((item) =>
        item.name === profile.name ? {...item, auth: null} : item,
      ),
    }))
    return profile.name
  }
}

export function providerOptions(
  profile: Profile,
  model = profile.model,
): ChatCompletionsOptions {
  if (profile.auth === null)
    throw new Error(
      `Login required for '${profile.name}'. Run msh login ${profile.name}.`,
    )
  const apiKey =
    profile.auth.kind === 'key'
      ? profile.auth.value
      : profile.auth.kind === 'env'
        ? process.env[profile.auth.variable]
        : undefined
  if (profile.auth.kind === 'env' && !apiKey)
    throw new Error(
      `Set ${profile.auth.variable} for profile '${profile.name}'`,
    )
  return {
    ...(profile.preset === 'deepseek' ? deepseekPreset : {}),
    baseURL: profile.baseURL,
    model,
    ...(apiKey ? {apiKey} : {}),
  }
}

/** Only this projection is printed; stored keys never enter CLI listings. */
export function publicProfile(profile: Profile) {
  return {
    name: profile.name,
    preset: profile.preset,
    baseURL: profile.baseURL,
    model: profile.model,
    authentication:
      profile.auth?.kind === 'env'
        ? `env:${profile.auth.variable}`
        : (profile.auth?.kind ?? 'logged-out'),
  }
}
