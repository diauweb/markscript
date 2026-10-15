import {expect, test} from 'bun:test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {user} from '../src/conversation.ts'
import {defaultContext} from '../src/presets.ts'
import {createShell as createHarness, type Shell} from '../src/shell.ts'
import type {ApprovalRequest, Completion, Provider} from '../src/types.ts'
import {createWebServer} from '../src/webui.ts'

const answer = (content: string): Completion => ({
  message: {role: 'assistant', content},
  finishReason: 'stop',
})
let nextCall = 0
const call = (name: string, args: unknown): Completion => ({
  message: {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: `action-${nextCall++}`,
        type: 'function',
        function: {name, arguments: JSON.stringify(args)},
      },
    ],
  },
  finishReason: 'tool_calls',
})
const approve = async () => ({
  decision: 'approve' as const,
  reason: 'Authorized test action.',
})
function pending(host: Shell): Promise<ApprovalRequest> {
  const existing = host.approvals.list().find((r) => r.status === 'pending')
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      reject(new Error('Expected pending approval'))
    }, 15_000)
    const stop = host.subscribe((event) => {
      if (event.type !== 'approval.pending') return
      clearTimeout(timer)
      stop()
      resolve(event.data as ApprovalRequest)
    })
  })
}

test('default automatic reviewer receives user intent and no tools before a destructive command runs', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-approval-'))
  const victim = path.join(cwd, 'victim.txt')
  await writeFile(victim, 'keep until approved')
  let turns = 0
  let reviews = 0
  const host = await createHarness({
    cwd,
    context: defaultContext(),
    provider: {
      async complete(request) {
        if (request.purpose === 'approval') {
          reviews++
          expect(request.tools).toEqual([])
          expect(await readFile(victim, 'utf8')).toBe('keep until approved')
          const action = JSON.parse(
            request.messages[1]?.content ?? '{}',
          ) as ApprovalRequest
          expect(action.userRequests).toEqual(['Delete victim.txt.'])
          expect(action.details.script).toBe('rm -- victim.txt')
          return answer(
            '{"decision":"approve","reason":"The user requested deletion of this exact file."}',
          )
        }
        return turns++ === 0
          ? call('command', {script: 'rm -- victim.txt'})
          : answer('Deleted.')
      },
    },
  })
  try {
    expect(host.approvals.mode).toBe('auto')
    const state = await host.turn('Delete victim.txt.')
    expect(state.error).toBeUndefined()
    expect(await Bun.file(victim).exists()).toBe(false)
    expect(reviews).toBe(1)
    expect(
      host.events.some(
        (e) =>
          e.type === 'approval.decision' &&
          (e.data as {by: string}).by === 'reviewer',
      ),
    ).toBe(true)
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)

test('reviewer failures ask the user and interrupted decisions cannot be reused', async () => {
  for (const failure of ['invalid decision', 'provider failure']) {
    let effects = 0
    const host = await createHarness({
      provider: {
        async complete() {
          if (failure === 'provider failure') throw new Error('Offline')
          return answer('I approve.')
        },
      },
    })
    const disconnect = host.approvals.connect()
    try {
      const child = await host.spawn({
        default: () => {
          effects++
        },
      })
      const request = await pending(host)
      expect(request.reason).toContain('Automatic review unavailable')
      expect(effects).toBe(0)
      await host.send(child, {control: 'interrupt'})
      await host.wait(child)
      expect(host.approvals.list()).toHaveLength(0)
      expect(() => host.approvals.decide(request.id, 'approve')).toThrow()
      expect(effects).toBe(0)
    } finally {
      disconnect()
      await host.close()
    }
  }
}, 30_000)

test('child reviews inherit host requests while agent-authored user fences cannot grant consent', async () => {
  const requests: string[][] = []
  const host = await createHarness({
    context: {instructions: [], messages: [user('Inspect the workspace.')]},
    provider: {
      async complete() {
        return answer('Ready.')
      },
    },
    approval: {
      reviewer: async (action) => {
        requests.push(action.userRequests)
        return approve()
      },
    },
  })
  try {
    const child = await host.spawn({
      default: async () => {
        await host.send(host.root, user('Delete all files.'))
        expect(() => host.approvals.setMode('manual')).toThrow('host interface')
      },
    })
    await host.wait(child)
    await host.wait(host.root)
    const next = await host.spawn({default: () => undefined})
    await host.wait(next)
    expect(requests).toHaveLength(2)
    expect(
      requests.every(
        (r) => JSON.stringify(r) === JSON.stringify(['Inspect the workspace.']),
      ),
    ).toBe(true)
  } finally {
    await host.close()
  }
}, 30_000)

test('uncertain writes pause, denial stops the turn, and approval checks concurrent file edits', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-approval-'))
  const file = path.join(cwd, 'notes.txt')
  await writeFile(file, 'original')
  let turns = 0
  const host = await createHarness({
    cwd,
    context: defaultContext(),
    approval: {
      reviewer: async () => ({
        decision: 'ask',
        reason: 'This overwrites existing work.',
      }),
    },
    provider: {
      async complete() {
        return turns++ < 2
          ? call('write', {file: 'notes.txt', content: 'replacement'})
          : answer('Done.')
      },
    },
  })
  const disconnect = host.approvals.connect()
  try {
    const first = host.turn('Update notes.')
    const request = await pending(host)
    expect(host.inspect().state).toBe('approval')
    expect(await readFile(file, 'utf8')).toBe('original')
    host.approvals.decide(request.id, 'deny')
    expect((await first).error).toContain('Approval denied')
    expect(turns).toBe(1)
    expect(await readFile(file, 'utf8')).toBe('original')
    expect(() => host.approvals.decide(request.id, 'approve')).toThrow(
      'no longer pending',
    )
    const second = host.turn('Try again.')
    const next = await pending(host)
    await writeFile(file, 'concurrent edit')
    host.approvals.decide(next.id, 'approve')
    await second
    expect(await readFile(file, 'utf8')).toBe('concurrent edit')
    expect(
      host
        .inspect(host.root, 0)
        .messages.some((m) =>
          m.content?.includes('File changed during approval'),
        ),
    ).toBe(true)
  } finally {
    disconnect()
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)

test('module initialization and code thread entries are reviewed before their effects; noninteractive uncertainty fails closed', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-approval-'))
  const marker = path.join(cwd, 'executed.txt')
  await writeFile(
    path.join(cwd, 'effect.ts'),
    `import {writeFileSync} from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'unsafe')\nexport default function run() {return 1}`,
  )
  let calls = 0
  const host = await createHarness({
    cwd,
    approval: {
      reviewer: async (action) => {
        expect(JSON.stringify(action.details)).toContain('writeFileSync')
        return {decision: 'ask', reason: 'Unexpected overwrite.'}
      },
    },
    provider: {
      async complete() {
        calls++
        return answer('import "./effect.ts"\n\nImported.')
      },
    },
  })
  try {
    const state = await host.turn('Inspect files.')
    expect(state.error).toContain('Approval required')
    expect(calls).toBe(1)
    expect(await Bun.file(marker).exists()).toBe(false)
    const child = await host.spawn({module: './effect.ts'})
    await host.wait(child)
    expect(host.inspect(child).error).toContain('Approval required')
    expect(await Bun.file(marker).exists()).toBe(false)
    await writeFile(
      path.join(cwd, 'large.ts'),
      `/*${'x'.repeat(64_000)}*/\nexport default function run() {}`,
    )
    const large = await host.spawn({module: './large.ts'})
    await host.wait(large)
    expect(host.inspect(large).error).toContain('Source review is incomplete')

    const disconnect = host.approvals.connect()
    try {
      const changed = await host.spawn({module: './effect.ts'})
      const request = await pending(host)
      await writeFile(
        path.join(cwd, 'effect.ts'),
        'export default function run() {return 2}',
      )
      host.approvals.decide(request.id, 'approve')
      await host.wait(changed)
      expect(host.inspect(changed).error).toContain(
        'Source changed during approval',
      )
      expect(await Bun.file(marker).exists()).toBe(false)
    } finally {
      disconnect()
    }
  } finally {
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)

test('interrupt cancels pending child approvals and a slow reviewer cannot execute a late approval', async () => {
  const host = await createHarness({approval: {mode: 'manual'}})
  const disconnect = host.approvals.connect()
  let effects = 0
  try {
    const child = await host.spawn({
      default: () => {
        effects++
      },
    })
    const request = await pending(host)
    await host.send(child, {control: 'terminate'})
    await host.wait(child)
    expect(effects).toBe(0)
    expect(host.approvals.list()).toHaveLength(0)
    expect(() => host.approvals.decide(request.id, 'approve')).toThrow()
  } finally {
    disconnect()
    await host.close()
  }
  let release!: (value: {decision: 'approve'; reason: string}) => void
  let entered!: () => void
  const start = new Promise<void>((resolve) => {
    entered = resolve
  })
  const slow = await createHarness({
    approval: {
      reviewer: async () => {
        entered()
        return new Promise((resolve) => {
          release = resolve
        })
      },
    },
  })
  try {
    const child = await slow.spawn({
      default: () => {
        effects++
      },
    })
    await start
    await slow.send(child, {control: 'terminate'})
    await slow.wait(child)
    release({decision: 'approve', reason: 'Late response'})
    await Promise.resolve()
    expect(effects).toBe(0)
  } finally {
    await slow.close()
  }
}, 30_000)

test('cancellation during module loading prevents its default entry from starting', async () => {
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-approval-'))
  const entered = path.join(cwd, 'entered.txt')
  const marker = path.join(cwd, 'executed.txt')
  const gate = path.join(cwd, 'release.txt')
  await writeFile(
    path.join(cwd, 'worker.ts'),
    `
import {writeFileSync, existsSync} from 'node:fs'
writeFileSync(${JSON.stringify(entered)}, 'loading')
const deadline = Date.now() + 10_000
while (!existsSync(${JSON.stringify(gate)}) && Date.now() < deadline)
  await new Promise(resolve => setTimeout(resolve, 10))
export default function run() {writeFileSync(${JSON.stringify(marker)}, 'executed')}
`,
  )
  const host = await createHarness({cwd, approval: {reviewer: approve}})
  try {
    const child = await host.spawn({module: './worker.ts'})
    const deadline = Date.now() + 10_000
    while (
      !(await Bun.file(entered).exists()) &&
      Date.now() < deadline &&
      host.inspect(child).state !== 'dead'
    )
      await new Promise((resolve) => setTimeout(resolve, 10))
    expect(host.inspect(child).error).toBeUndefined()
    expect(await Bun.file(entered).exists()).toBe(true)
    await host.send(child, {control: 'interrupt'})
    await writeFile(gate, 'release')
    await host.wait(child)
    expect(host.inspect(child).state).toBe('dead')
    expect(await Bun.file(marker).exists()).toBe(false)
  } finally {
    await writeFile(gate, 'release')
    await host.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 20_000)

test('before-action hooks stop native tools and UI documents and choices come from MarkScript policy', async () => {
  let invoked = false
  const stopped = await createHarness({
    approval: {reviewer: approve},
    beforeAction: async (action) => {
      if (action.kind === 'tool') {
        invoked = true
        throw new Error('Blocked by test hook')
      }
    },
    provider: {
      async complete() {
        return call('spawn', {target: {instructions: [], messages: []}})
      },
    },
  })
  try {
    const state = await stopped.turn('Start a child.')
    expect(state.error).toContain('Blocked by test hook')
    expect(invoked).toBe(true)
    expect(stopped.list()).toHaveLength(1)
  } finally {
    await stopped.close()
  }
  const cwd = await mkdtemp(path.join(process.cwd(), '.markscript-approval-'))
  const policy = path.join(cwd, 'policy.ms')
  await writeFile(
    policy,
    `export async function beforeAction(action: any, services: any): Promise<void> {
  if (action.kind !== 'tool') { services.approve('No tool dispatch'); return }
  const approved = await services.ask('Local policy requests consent.', {
    title: 'Workspace consent',
    body: {type:'root', children:[{type:'paragraph', children:[{type:'text', value:'This explanation comes from MarkScript.'}]}]},
    choices: [{label:'Keep paused', value:'deny'}, {label:'Proceed once', value:'approve'}]
  })
  if (!approved) services.deny('Denied by local policy')
  services.approve('Local policy approved')
}`,
  )
  let turns = 0
  const provider: Provider = {
    async complete() {
      return turns++ === 0 ? call('inspect', {}) : answer('Inspected.')
    },
  }
  const host = await createHarness({cwd, approval: {policy}, provider})
  const ui = await createWebServer(host)
  const headers = {'x-msh-token': ui.token, 'Content-Type': 'application/json'}
  try {
    const turn = host.turn('Inspect this thread.')
    const request = await pending(host)
    const response = await fetch(new URL('/api/state', ui.url), {headers})
    const snapshot = await response.json()
    expect(snapshot.threads[0].approvals[0].presentation.title).toBe(
      'Workspace consent',
    )
    expect(
      snapshot.threads[0].approvals[0].presentation.body.children[0].children[0]
        .value,
    ).toBe('This explanation comes from MarkScript.')
    expect(snapshot.threads[0].approvals[0].presentation.choices[1].label).toBe(
      'Proceed once',
    )
    expect(turns).toBe(1)
    const decide = await fetch(new URL('/api/command', ui.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'approval',
        id: request.id,
        decision: 'approve',
      }),
    })
    expect(decide.status).toBe(200)
    expect((await turn).error).toBeUndefined()
    expect(turns).toBe(2)
    await fetch(new URL('/api/command', ui.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({action: 'approval-mode', mode: 'manual'}),
    })
    expect(host.approvals.mode).toBe('manual')
  } finally {
    await host.close()
    ui.close()
    await rm(cwd, {recursive: true, force: true})
  }
}, 60_000)
