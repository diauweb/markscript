import {chmod, mkdir, open, realpath, rename, rm} from 'node:fs/promises'
import path from 'node:path'
import lockfile from 'proper-lockfile'

export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

export async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, {recursive: true, mode: 0o700})
  await chmod(directory, 0o700)
}

/** Shared heartbeat settings make writers agree on when a crashed lease expires. */
export async function lease(filename: string) {
  const target = await realpath(filename).catch(async (error: unknown) => {
    if (!isMissing(error)) throw error
    return path.join(
      await realpath(path.dirname(filename)),
      path.basename(filename),
    )
  })
  let compromised: Error | undefined
  const release = await lockfile
    .lock(target, {
      realpath: false,
      stale: 60_000,
      update: 10_000,
      retries: 0,
      onCompromised: (error) => {
        compromised = error
      },
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ELOCKED')
        throw new Error(`Already in use by another msh process: ${filename}`)
      throw error
    })
  let closed = false
  return {
    check() {
      if (closed || compromised)
        throw new Error(
          'Storage lease was lost; reopen the journal before writing',
        )
    },
    async close() {
      if (closed) return
      closed = true
      if (!compromised) await release()
    },
  }
}

/** Atomic replacement, private permissions, and durable file and directory entries. */
export async function writeJson(
  filename: string,
  value: unknown,
): Promise<void> {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, filename)
    const directory = await open(path.dirname(filename), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } finally {
    await rm(temporary, {force: true})
  }
}
