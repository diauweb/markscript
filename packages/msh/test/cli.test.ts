import {afterAll, beforeAll, expect, test} from 'bun:test'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {frame} from './fixtures/chat-completions.ts'

let directory: string
const cli = path.resolve(import.meta.dir, '../dist/cli.js')
beforeAll(async () => {
  directory = await mkdtemp('/tmp/msh-v1-cli-')
})
afterAll(async () => {
  await rm(directory, {recursive: true, force: true})
})
async function run(args: string[], input?: string) {
  const p = Bun.spawn([process.execPath, cli, ...args], {
    cwd: directory,
    env: {
      ...process.env,
      MSH_HOME: path.join(directory, 'home'),
      LANGSMITH_TRACING: 'false',
    },
    stdin: input === undefined ? 'ignore' : new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ])
  return {code, stdout, stderr}
}
test('built demo works outside the repository and saved history is inspectable and exportable', async () => {
  const result = await run(['demo'])
  expect(result).toMatchObject({code: 0, stderr: ''})
  expect(result.stdout).toContain('42')
  const sessions = await run(['sessions', '--json'])
  const rows = JSON.parse(sessions.stdout)
  expect(rows[0].version).toBe(2)
  const shown = await run(['sessions', 'show', rows[0].id])
  expect(shown.stdout).toContain('assistant')
  expect(shown.stdout).toContain('42')
  const exported = await run(['sessions', 'export', rows[0].id])
  const events = exported.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(
    events.some(
      (e) =>
        e.type === 'tool.end' && e.data.name === 'call' && e.data.result === 42,
    ),
  ).toBe(true)
  const markdown = await run(['sessions', 'export', rows[0].id, '--markdown'])
  expect(markdown.code).toBe(0)
  expect(markdown.stdout).toContain(':::user')
  expect(markdown.stdout).toContain('```tool-call id="demo-add" name="call"')
  expect(markdown.stdout).toContain('```tool-result id="demo-add"')
  expect(
    events.some(
      (e) =>
        e.type === 'agent.context' &&
        e.data.abilities.some((a: {name: string}) => a.name === 'add'),
    ),
  ).toBe(true)
}, 60_000)
test('packaged CLI uses a local SSE endpoint, emitted tools, child threads, exec, and workspace files', async () => {
  let step = 0
  let child = ''
  const requests: unknown[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.url.endsWith('/models'))
        return Response.json({data: [{id: 'fixture'}]})
      const body = (await request.json()) as {
        messages: {
          role: string
          content: string | null
          tool_call_id?: string
        }[]
        tools: {function: {name: string}}[]
      }
      if (body.messages[0]?.content?.startsWith('# Approval reviewer')) {
        expect(body.tools ?? []).toHaveLength(0)
        return stream(
          '{"decision":"approve","reason":"Authorized local fixture action."}',
        )
      }
      requests.push(body)
      // A child receives only the focused context and replies independently.
      if (body.messages[0]?.content?.includes('# Child fixture'))
        return stream('Child report.')
      const last = body.messages.at(-1)
      switch (step++) {
        case 0:
          return stream(
            'export function seven(): number {return 7}\n\n{String(seven())}',
          )
        case 1:
          return tool('call', {name: 'seven', arguments: {}})
        case 2:
          expect(last?.content).toBe('7')
          return tool('write', {
            file: 'verified.txt',
            content: 'verified by fixture',
          })
        case 3:
          return tool('spawn', {
            target: {
              instructions: ['# Child fixture'],
              messages: [':::user\nReturn the child report.\n:::'],
            },
          })
        case 4:
          child = JSON.parse(last?.content ?? 'null')
          return tool('wait', {handle: child})
        case 5:
          return tool('inspect', {handle: child})
        case 6:
          expect(last?.content).toContain('Child report.')
          return tool('exec', {
            instructions: ['# Replacement'],
            messages: [
              ':::user\nThe file was verified. Reply with Completed.\n:::',
            ],
          })
        default:
          expect(body.tools.some((t) => t.function.name === 'seven')).toBe(
            false,
          )
          return stream('Completed.')
      }
    },
  })
  function stream(content: string) {
    return new Response(
      `${frame({choices: [{delta: {content}, finish_reason: 'stop'}]})}data: [DONE]\n\n`,
      {headers: {'Content-Type': 'text/event-stream'}},
    )
  }
  function tool(name: string, args: unknown) {
    return new Response(
      `${frame({choices: [{delta: {tool_calls: [{index: 0, id: `call-${step}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]}, finish_reason: 'tool_calls'}]})}data: [DONE]\n\n`,
      {headers: {'Content-Type': 'text/event-stream'}},
    )
  }
  try {
    const login = await run([
      'login',
      'fixture',
      '--base-url',
      `http://127.0.0.1:${server.port}/v1`,
      '--model',
      'fixture',
      '--no-auth',
    ])
    expect(login.code).toBe(0)
    const result = await run([
      'chat',
      '--profile',
      'fixture',
      '--prompt',
      'Exercise the V1 runtime.',
    ])
    expect(result).toMatchObject({code: 0, stdout: 'Completed.\n', stderr: ''})
    expect(await readFile(path.join(directory, 'verified.txt'), 'utf8')).toBe(
      'verified by fixture',
    )
    expect(requests.length).toBeGreaterThan(7)
  } finally {
    server.stop(true)
  }
}, 90_000)
test('profile listings exclude stored authentication secrets', async () => {
  const secret = 'fixture-secret-private'
  const login = await run(
    [
      'login',
      'secret',
      '--base-url',
      'http://127.0.0.1:9/v1',
      '--model',
      'fixture',
      '--key-stdin',
      '--no-verify',
    ],
    secret,
  )
  expect(login.code).toBe(0)
  const listed = await run(['profiles', '--json'])
  expect(listed.stdout).not.toContain(secret)
}, 30_000)
