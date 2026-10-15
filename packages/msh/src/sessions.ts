import {mkdir, readdir, readFile} from 'node:fs/promises'
import path from 'node:path'
import {Schema} from 'effect'
import {locations} from './settings.ts'
import {isMissing, privateDirectory, writeJson} from './storage.ts'

const sessionSchema = Schema.Struct({
  version: Schema.Literals([1, 2]),
  id: Schema.String,
  title: Schema.String,
  cwd: Schema.String,
  profile: Schema.String,
  model: Schema.String,
  contextBudget: Schema.Number,
  maxOutputTokens: Schema.Number,
  maxTurns: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Session = typeof sessionSchema.Type
const idPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u

export class SessionStore {
  constructor(readonly directory = locations().sessions) {}

  path(id: string): string {
    if (!idPattern.test(id)) throw new Error('Invalid session ID')
    return path.join(this.directory, id)
  }

  journal(id: string, version = 2): string {
    return path.join(
      this.path(id),
      version === 1 ? 'session.ms' : 'history.jsonl',
    )
  }

  async allocate(
    input: Pick<
      Session,
      | 'title'
      | 'cwd'
      | 'profile'
      | 'model'
      | 'contextBudget'
      | 'maxOutputTokens'
      | 'maxTurns'
    >,
  ): Promise<Session> {
    await privateDirectory(this.directory)
    const now = new Date().toISOString()
    const journal: Session = {
      version: 2,
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    }
    await mkdir(this.path(journal.id), {mode: 0o700})
    return journal
  }

  async save(journal: Session): Promise<void> {
    await writeJson(path.join(this.path(journal.id), 'metadata.json'), journal)
  }

  async list(): Promise<Session[]> {
    const entries = await readdir(this.directory, {withFileTypes: true}).catch(
      (error: unknown) => {
        if (isMissing(error)) return []
        throw error
      },
    )
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && idPattern.test(entry.name))
        .map(async (entry) => {
          const filename = path.join(this.path(entry.name), 'metadata.json')
          const source = await readFile(filename, 'utf8').catch(
            (error: unknown) => {
              if (isMissing(error)) return undefined
              throw error
            },
          )
          if (source === undefined) return undefined
          try {
            const journal = Schema.decodeUnknownSync(sessionSchema)(
              JSON.parse(source),
            )
            if (journal.id !== entry.name) throw new Error('ID mismatch')
            return journal
          } catch {
            throw new Error(`Invalid session metadata: ${filename}`)
          }
        }),
    )
    return sessions
      .filter((journal): journal is Session => journal !== undefined)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      )
  }

  async find(id?: string): Promise<Session> {
    const sessions = await this.list()
    if (!id) {
      if (!sessions[0])
        throw new Error('No saved sessions. Start one with msh chat.')
      return sessions[0]
    }
    const matches = sessions.filter((journal) => journal.id.startsWith(id))
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? `Ambiguous session ID '${id}'; use a longer prefix`
          : `Unknown session '${id}'`,
      )
    return matches[0] as Session
  }
}
