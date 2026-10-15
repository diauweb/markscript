import {readdir, readFile, realpath, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {useContext} from './context.ts'

const limit = 24_000
const bounded = (text: string) =>
  text.length > limit ? `${text.slice(0, limit)}\n[output truncated]` : text
/** Read a UTF-8 file, optionally selecting a one-based line range. */
export async function read(
  file: string,
  start = 1,
  lines = 200,
): Promise<string> {
  if (
    !Number.isInteger(start) ||
    start < 1 ||
    !Number.isInteger(lines) ||
    lines < 1
  )
    throw new Error('Use positive integer line ranges')
  const c = useContext()
  const text = await readFile(path.resolve(c.cwd, file), {
    encoding: 'utf8',
    signal: c.signal,
  })
  return bounded(
    text
      .split('\n')
      .slice(start - 1, start - 1 + lines)
      .map((line, i) => `${start + i}: ${line}`)
      .join('\n'),
  )
}
/** List files and directories immediately inside a directory. */
export async function list(directory = '.'): Promise<string> {
  const entries = await readdir(path.resolve(useContext().cwd, directory), {
    withFileTypes: true,
  })
  return bounded(
    entries
      .map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`)
      .sort()
      .join('\n'),
  )
}
/** Search file contents using a ripgrep regular expression. */
export async function search(
  pattern: string,
  directory = '.',
): Promise<{exitCode: number; stdout: string; stderr: string}> {
  return run([
    'rg',
    '--line-number',
    '--color=never',
    '--max-count=100',
    '--',
    pattern,
    directory,
  ])
}
/** Write a complete UTF-8 file. Read existing files first. */
export async function write(file: string, content: string): Promise<string> {
  const c = useContext()
  const filename = path.resolve(c.cwd, file)
  const before = await existing(filename)
  await approveEdit('write', filename, before, content)
  await writeFile(filename, content, {
    signal: c.signal,
    flag: before === undefined ? 'wx' : 'w',
  })
  return `Wrote ${file}`
}
/** Replace one exact occurrence. Ambiguous or missing text fails without writing. */
export async function replace(
  file: string,
  before: string,
  after: string,
): Promise<string> {
  if (!before) throw new Error('Replacement requires nonempty existing text')
  const c = useContext()
  const filename = path.resolve(c.cwd, file)
  const text = await readFile(filename, {encoding: 'utf8', signal: c.signal})
  const index = text.indexOf(before)
  if (index < 0 || text.indexOf(before, index + before.length) >= 0)
    throw new Error('Expected exactly one match')
  const content =
    text.slice(0, index) + after + text.slice(index + before.length)
  await approveEdit('replace', filename, text, content)
  await writeFile(filename, content, {signal: c.signal})
  return `Updated ${file}`
}
/** Run a shell command with bounded output. Cancellation terminates its process group. */
export async function command(
  script: string,
  timeoutSeconds = 120,
): Promise<{exitCode: number; stdout: string; stderr: string}> {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
    throw new Error('timeoutSeconds must be positive')
  await useContext().host.authorize({
    kind: 'command',
    title: 'Run shell command',
    details: {script, shell: 'bash -lc', timeoutSeconds},
  })
  return run(['bash', '-lc', script], timeoutSeconds * 1000)
}
async function existing(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
async function approveEdit(
  kind: 'write' | 'replace',
  filename: string,
  before: string | undefined,
  after: string,
) {
  const target =
    before === undefined
      ? path.join(
          await realpath(path.dirname(filename)),
          path.basename(filename),
        )
      : await realpath(filename)
  const c = useContext()
  await c.host.authorize({
    kind,
    title: `${before === undefined ? 'Create' : 'Update'} ${filename}`,
    details: {file: filename, target, before: before ?? null, after},
  })
  useContext()
  const currentTarget =
    before === undefined
      ? path.join(
          await realpath(path.dirname(filename)),
          path.basename(filename),
        )
      : await realpath(filename)
  if (currentTarget !== target || (await existing(filename)) !== before)
    throw new Error(
      'File changed during approval. Read it again before editing.',
    )
}
async function run(argv: string[], timeout = 120_000) {
  const c = useContext()
  const child = Bun.spawn(argv, {
    cwd: c.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    detached: process.platform !== 'win32',
  })
  let killed = false
  const kill = () => {
    killed = true
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch {
      /* Process may already have exited. */
    }
  }
  c.signal.addEventListener('abort', kill, {once: true})
  const timer = setTimeout(kill, timeout)
  const capture = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    let text = ''
    let truncated = false
    for await (const chunk of stream) {
      const part = decoder.decode(chunk, {stream: true})
      if (text.length + part.length > limit) truncated = true
      text = (text + part).slice(0, limit)
    }
    text += decoder.decode()
    return text + (truncated ? '\n[output truncated]' : '')
  }
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      capture(child.stdout),
      capture(child.stderr),
    ])
    c.signal.throwIfAborted()
    return {
      exitCode,
      stdout,
      stderr: stderr + (killed ? '\n[command timed out]' : ''),
    }
  } finally {
    clearTimeout(timer)
    c.signal.removeEventListener('abort', kill)
  }
}
