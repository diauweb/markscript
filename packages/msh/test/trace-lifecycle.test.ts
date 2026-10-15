import {expect, test} from 'bun:test'
import {ContextTransfer} from '../src/context.ts'
import type {RuntimeEvent} from '../src/core-types.ts'
import {defineExtension} from '../src/extensions.ts'
import {createHarness} from '../src/host.ts'
import {Shell} from '../src/shell.ts'

function requiredEvent(event: RuntimeEvent | undefined): RuntimeEvent {
  if (!event) throw new Error('Expected runtime event')
  return event
}

test('observers retain creation and shutdown records and flush once after cleanup', async () => {
  const events: RuntimeEvent[] = []
  let flushed: RuntimeEvent[] = []
  let flushes = 0
  const shell = new Shell({
    observer: {
      event: (event) => events.push(event),
      async flush() {
        flushes++
        flushed = [...events]
      },
    },
  })
  await shell.initialize()
  const close = shell.close()
  expect(shell.close()).toBe(close)
  await close
  expect(events[0]?.type).toBe('thread.created')
  expect(events[0]?.thread).toBe(shell.root)
  expect(events.map((event) => event.seq)).toEqual(
    shell.events.map((event) => event.seq),
  )
  expect(flushed.some((event) => event.type === 'agent.closed')).toBe(true)
  expect(
    flushed.some(
      (event) =>
        event.type === 'thread.state' &&
        (event.data as {state: string}).state === 'dead',
    ),
  ).toBe(true)
  expect(flushes).toBe(1)
})

test('observer flush failures reject close and initialization failures still flush', async () => {
  const failure = new Error('Trace export failed')
  const shell = await new Shell({
    observer: {
      event() {},
      async flush() {
        throw failure
      },
    },
  }).initialize()
  await expect(shell.close()).rejects.toBe(failure)
  await expect(shell.close()).rejects.toBe(failure)

  let flushed = false
  const invalid = new Shell({
    approval: {
      reviewer: async () => ({decision: 'approve', reason: 'Test fixture'}),
    },
    context: {
      instructions: ['{(() => {throw new Error("Invalid context")})()}'],
      messages: [],
    },
    observer: {
      event() {},
      async flush() {
        flushed = true
      },
    },
  })
  await expect(invalid.initialize()).rejects.toThrow('Invalid context')
  expect(flushed).toBe(true)
  expect(invalid.runtime.inspect().state).toBe('dead')
  expect(
    invalid.events.find((event) => event.type === 'error')?.data,
  ).toMatchObject({message: expect.stringContaining('Invalid context')})
})

test('concurrent abilities keep separate spans and preserve their parent evaluation', async () => {
  const host = await createHarness({
    context: {
      instructions: [
        'export async function apply(work: () => Promise<string>): Promise<string> { return work() }',
      ],
      messages: [],
    },
  })
  try {
    await host.execute(host.root, async () => {
      await host.activity(
        host.root,
        'evaluation',
        'Concurrent evaluation',
        {},
        async () => {
          await Promise.all(
            ['first', 'second'].map((label) =>
              host.invoke(host.root, 'apply', [
                async () => {
                  await Promise.resolve()
                  host.record(host.root, 'evidence', {label})
                  return label
                },
              ]),
            ),
          )
        },
      )
    })
    const starts = host.events.filter(
      (event) => event.type === 'activity.start',
    )
    const parent = requiredEvent(
      starts.find(
        (event) => (event.data as {kind: string}).kind === 'evaluation',
      ),
    )
    const abilities = starts.filter(
      (event) => (event.data as {kind: string}).kind === 'ability',
    )
    expect(abilities).toHaveLength(2)
    expect(new Set(abilities.map((event) => event.span)).size).toBe(2)
    for (const ability of abilities) {
      expect(ability.parentSpan).toBe(parent.span)
      expect(ability.invocation).toBe(parent.invocation)
      const evidence = requiredEvent(
        host.events.find(
          (event) => event.type === 'evidence' && event.span === ability.span,
        ),
      )
      const end = requiredEvent(
        host.events.find(
          (event) =>
            event.type === 'activity.end' && event.span === ability.span,
        ),
      )
      expect(end.data).toMatchObject({
        output: (evidence.data as {label: string}).label,
      })
    }
  } finally {
    await host.close()
  }
})

test('evaluations retain source, output, and errors as matched activity records', async () => {
  const host = await createHarness()
  try {
    await host.evaluate(host.root, ['# Evaluated output'])
    await expect(
      host.evaluate(host.root, [
        '{(() => {throw new Error("Evaluation failed")})()}',
      ]),
    ).rejects.toThrow('Evaluation failed')
    const starts = host.events.filter(
      (event) => event.type === 'activity.start',
    )
    expect(starts).toHaveLength(2)
    expect(starts[0]?.data).toMatchObject({
      input: {parts: ['# Evaluated output']},
    })
    const ends = host.events.filter((event) => event.type === 'activity.end')
    expect(ends[0]?.span).toBe(starts[0]?.span)
    expect(ends[0]?.data).toMatchObject({
      output: {records: [{text: '# Evaluated output\n'}]},
    })
    expect(ends[1]?.span).toBe(starts[1]?.span)
    expect(ends[1]?.data).toMatchObject({
      error: expect.stringContaining('Evaluation failed'),
    })
  } finally {
    await host.close()
  }
})

test('interruption ends an ability that does not cooperate with cancellation', async () => {
  const host = await createHarness({
    context: {
      instructions: [
        'export async function apply(work: () => Promise<string>): Promise<string> { return work() }',
      ],
      messages: [],
    },
  })
  try {
    const started = Promise.withResolvers<void>()
    const pending = host.invoke(host.root, 'apply', [
      () => {
        started.resolve()
        return new Promise(() => {})
      },
    ])
    const rejected = pending.catch((error: unknown) => error)
    await started.promise
    await host.send(host.root, {control: 'interrupt'})
    expect(await rejected).toMatchObject({message: 'Interrupted'})
    const ends = host.events.filter((event) => event.type === 'activity.end')
    expect(ends).toHaveLength(1)
    expect(ends[0]?.data).toMatchObject({cancelled: true, error: 'Interrupted'})
  } finally {
    await host.close()
  }
})

test('child threads retain creating activity ancestry and context transfer is a successful control boundary', async () => {
  const host = await createHarness()
  try {
    let child = ''
    await host.execute(host.root, async () => {
      await expect(
        host.activity(
          host.root,
          'evaluation',
          'Transfer context',
          {},
          async () => {
            child = await host.spawn({instructions: [], messages: []})
            throw new ContextTransfer()
          },
        ),
      ).rejects.toBeInstanceOf(ContextTransfer)
    })
    await host.wait(child)
    const start = requiredEvent(
      host.events.find((event) => event.type === 'activity.start'),
    )
    const created = requiredEvent(
      host.events.find(
        (event) => event.type === 'thread.created' && event.thread === child,
      ),
    )
    expect(created.data).toMatchObject({
      parent: host.root,
      parentSpan: start.span,
      parentInvocation: start.invocation,
    })
    const end = requiredEvent(
      host.events.find((event) => event.type === 'activity.end'),
    )
    expect(end.data).toMatchObject({transferred: true})
    expect(end.data).not.toHaveProperty('error')
  } finally {
    await host.close()
  }
})

test('concurrent managed invocations end independently and preserve the active turn identity', async () => {
  const launchStarted = Promise.withResolvers<void>()
  const finishLaunch = Promise.withResolvers<void>()
  const host = await createHarness({
    context: {
      instructions: [
        'export async function apply(work: () => Promise<string>): Promise<string> { return work() }',
      ],
      messages: [],
    },
    extensions: [
      defineExtension('test.traced-input', (scope) => {
        scope.hook<{thread: string}>('input', async ({thread}) => {
          await scope.host.receive(thread)
          launchStarted.resolve()
          await finishLaunch.promise
          scope.host.record(thread, 'launch.evidence', {})
        })
      }),
    ],
  })
  const firstStarted = Promise.withResolvers<void>()
  const secondStarted = Promise.withResolvers<void>()
  const firstResult = Promise.withResolvers<string>()
  const secondResult = Promise.withResolvers<string>()
  try {
    await host.send(host.root, 'Start input')
    await launchStarted.promise
    const launch = requiredEvent(
      host.events.find(
        (event) =>
          event.type === 'invocation.start' &&
          (event.data as {kind: string}).kind === 'turn',
      ),
    )
    if (!launch.invocation) throw new Error('Expected launch invocation')
    const first = host.invoke(host.root, 'apply', [
      () => {
        firstStarted.resolve()
        return firstResult.promise
      },
    ])
    const second = host.invoke(host.root, 'apply', [
      () => {
        secondStarted.resolve()
        return secondResult.promise
      },
    ])
    await Promise.all([firstStarted.promise, secondStarted.promise])
    const starts = host.events.filter(
      (event) =>
        event.type === 'invocation.start' &&
        (event.data as {kind: string}).kind === 'managed',
    )
    expect(starts).toHaveLength(2)
    expect(
      new Set([...starts, launch].map((event) => event.invocation)).size,
    ).toBe(3)

    secondResult.resolve('second')
    expect(await second).toBe('second')
    expect(
      host.events
        .filter((event) => event.type === 'invocation.end')
        .map((event) => event.invocation),
    ).toEqual([starts[1]?.invocation])
    firstResult.resolve('first')
    expect(await first).toBe('first')
    expect(
      host.events
        .filter((event) => event.type === 'invocation.end')
        .map((event) => event.invocation),
    ).toEqual([starts[1]?.invocation, starts[0]?.invocation])
    expect(host.inspect().state).toBe('running')
    expect(
      await host.execute(host.root, async (context) => context.invocation),
    ).toBe(launch.invocation)

    finishLaunch.resolve()
    await host.wait(host.root)
    expect(
      host.events.find((event) => event.type === 'launch.evidence')?.invocation,
    ).toBe(launch.invocation)
    const end = requiredEvent(
      host.events.filter((event) => event.type === 'invocation.end').at(-1),
    )
    expect(end.invocation).toBe(launch.invocation)
    expect(end.data).not.toHaveProperty('error')
  } finally {
    firstResult.resolve('first')
    secondResult.resolve('second')
    finishLaunch.resolve()
    await host.close()
  }
})

test('code thread traces distinguish returned values, undefined, errors, and external cancellation', async () => {
  const host = await createHarness()
  try {
    for (const result of [42, undefined]) {
      const child = await host.spawn({default: () => result})
      await host.wait(child)
      const completion = requiredEvent(
        host.events.find(
          (event) => event.thread === child && event.type === 'invocation.end',
        ),
      )
      expect(completion.data).not.toHaveProperty('error')
      expect(completion.data).not.toHaveProperty('cancelled')
      expect(
        host.events.find(
          (event) => event.thread === child && event.type === 'result',
        )?.data,
      ).toBe(result ?? null)
    }

    const broken = await host.spawn({
      default: () => {
        throw new Error('Code failed')
      },
    })
    await host.wait(broken)
    const failure = requiredEvent(
      host.events.find(
        (event) => event.thread === broken && event.type === 'invocation.end',
      ),
    )
    expect(failure.data).toMatchObject({error: 'Code failed'})
    expect(failure.data).not.toHaveProperty('cancelled')

    const started = Promise.withResolvers<void>()
    const child = await host.spawn({
      default: () => {
        started.resolve()
        return new Promise(() => {})
      },
    })
    await started.promise
    await host.send(child, {control: 'terminate'})
    await host.wait(child)
    const cancellation = requiredEvent(
      host.events.find(
        (event) => event.thread === child && event.type === 'invocation.end',
      ),
    )
    expect(cancellation.data).toMatchObject({
      error: 'Terminated',
      cancelled: true,
    })
  } finally {
    await host.close()
  }
})

test('activity traces preserve committed context transfer when the previous scope is cancelled', async () => {
  const controller = new AbortController()
  const host = await createHarness({
    onEvent(event) {
      if (
        event.type === 'context' &&
        (event.data as {generation: number}).generation === 1
      )
        controller.abort(new Error('Extension scope disposed'))
    },
  })
  try {
    await expect(
      host.execute(
        host.root,
        () =>
          host.activity(host.root, 'evaluation', 'Replace context', {}, () =>
            host.replace(host.root, {instructions: [], messages: []}),
          ),
        undefined,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(ContextTransfer)
    const end = requiredEvent(
      host.events.find((event) => event.type === 'activity.end'),
    )
    expect(end.data).toMatchObject({transferred: true})
    expect(end.data).not.toHaveProperty('error')
    expect(end.data).not.toHaveProperty('cancelled')
    expect(host.inspect().generation).toBe(1)
  } finally {
    await host.close()
  }
})
