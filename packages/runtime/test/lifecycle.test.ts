import {describe, expect, test} from 'bun:test'
import {
  executeDocument,
  Fragment,
  jsx,
  jsxs,
  MarkScriptRuntimeError,
  onReady,
  onTransform,
  type ReadonlyRoot,
  stripData,
} from '../src/index.ts'

function deferred(): {promise: Promise<void>; resolve: () => void} {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {promise, resolve}
}

describe('document lifecycle', () => {
  test('resolves async components depth-first and left-to-right', async () => {
    const events: string[] = []

    async function Child({name}: {name: string}) {
      events.push(`${name}:start`)
      await Promise.resolve()
      events.push(`${name}:resumed`)
      onTransform(() => events.push(`${name}:transform`))
      return name
    }

    async function Parent({children}: {children?: unknown}) {
      events.push('parent')
      return jsx('p', {children})
    }

    const root = await executeDocument(() =>
      jsx(Parent, {
        children: jsxs(Fragment, {
          children: [jsx(Child, {name: 'first'}), jsx(Child, {name: 'second'})],
        }),
      }),
    )

    expect(events).toEqual([
      'first:start',
      'first:resumed',
      'second:start',
      'second:resumed',
      'parent',
      'first:transform',
      'second:transform',
    ])
    expect(root.children[0]).toMatchObject({
      type: 'paragraph',
      children: [{value: 'first'}, {value: 'second'}],
    })
  })

  test('runs async transform and ready callbacks sequentially', async () => {
    const events: string[] = []
    let afterRoot: ReadonlyRoot | undefined

    const root = await executeDocument(() => {
      events.push('render')
      onTransform(async ({root: working}) => {
        events.push(`transform-1:${working.children.length}`)
        await Promise.resolve()
        working.children.push({
          type: 'paragraph',
          children: [{type: 'text', value: 'second'}],
        })
        events.push('transform-1-done')
      })
      onTransform(({root: working}) => {
        events.push(`transform-2:${working.children.length}`)
      })
      onReady(async ({root: finalRoot}) => {
        afterRoot = finalRoot
        events.push(`ready-1:${finalRoot.children.length}`)
        await Promise.resolve()
        events.push('ready-1-done')
      })
      onReady(() => {
        events.push('ready-2')
      })
      return 'first'
    })

    expect(events).toEqual([
      'render',
      'transform-1:1',
      'transform-1-done',
      'transform-2:2',
      'ready-1:2',
      'ready-1-done',
      'ready-2',
    ])
    expect(afterRoot).toBe(root)
  })

  test('deep-freezes the final tree before ready callbacks and return', async () => {
    let mutationError: unknown
    const root = await executeDocument(() => {
      onReady(({root: finalRoot}) => {
        try {
          // biome-ignore lint/correctness/noUnsafeOptionalChaining: this fixture intentionally reaches through the known first child to test frozen mutation.
          ;(finalRoot.children[0]?.data as {style: {role: string}}).style.role =
            'changed'
        } catch (error) {
          mutationError = error
        }
      })
      return {
        type: 'paragraph',
        data: {style: {role: 'lead'}, tags: ['one']},
        children: [{type: 'text', value: 'frozen'}],
      }
    })

    expect(mutationError).toBeInstanceOf(TypeError)
    expect(Object.isFrozen(root)).toBe(true)
    expect(Object.isFrozen(root.children)).toBe(true)
    expect(Object.isFrozen(root.children[0]?.data)).toBe(true)
    expect(
      // biome-ignore lint/correctness/noUnsafeOptionalChaining: the document returned immediately above always has a first child.
      Object.isFrozen((root.children[0]?.data as {style: object}).style),
    ).toBe(true)

    const bare = stripData(root)
    expect(bare.children[0]?.data).toBeUndefined()
    expect(root.children[0]?.data).toEqual({
      style: {role: 'lead'},
      tags: ['one'],
    })

    await expect(
      executeDocument(() => ({
        type: 'paragraph',
        data: {opaque: new Map([['mutable', true]])},
        children: [{type: 'text', value: 'not safely freezable'}],
      })),
    ).rejects.toMatchObject({code: 'ERR1201'})
  })

  test('validation gates ready callbacks', async () => {
    let afterRan = false
    const result = executeDocument(() => {
      onTransform(({root}) => {
        ;(root.children[0] as {type: string}).type = 'notMdast'
      })
      onReady(() => {
        afterRan = true
      })
      return 'x'
    })

    await expect(result).rejects.toMatchObject({code: 'ERR1201'})
    expect(afterRan).toBe(false)
  })

  test('is fail-fast in transform and ready phases', async () => {
    const transformEvents: string[] = []
    await expect(
      executeDocument(() => {
        onTransform(() => {
          transformEvents.push('first')
          throw new Error('transform failed')
        })
        onTransform(() => {
          transformEvents.push('second')
        })
        onReady(() => transformEvents.push('ready'))
        return 'x'
      }),
    ).rejects.toThrow('transform failed')
    expect(transformEvents).toEqual(['first'])

    const afterEvents: string[] = []
    await expect(
      executeDocument(() => {
        onReady(() => {
          afterEvents.push('first')
          throw new Error('ready failed')
        })
        onReady(() => afterEvents.push('second'))
        return 'x'
      }),
    ).rejects.toThrow('ready failed')
    expect(afterEvents).toEqual(['first'])
  })

  test('rejects registration outside render and in later phases', async () => {
    expect(() => onTransform(() => {})).toThrow(MarkScriptRuntimeError)
    expect(() => onReady(() => {})).toThrow(MarkScriptRuntimeError)

    await expect(
      executeDocument(() => {
        onTransform(() => onReady(() => {}))
        return 'x'
      }),
    ).rejects.toMatchObject({code: 'ERR1301'})
  })

  test('isolates callbacks across concurrent asynchronous renders', async () => {
    const firstGate = deferred()
    const secondGate = deferred()
    const events: string[] = []

    const first = executeDocument(async () => {
      onTransform(({root}) => {
        events.push(`first:${root.children[0]?.type}`)
      })
      await firstGate.promise
      onReady(() => events.push('first-ready'))
      return 'first'
    })
    const second = executeDocument(async () => {
      onTransform(({root}) => {
        events.push(`second:${root.children[0]?.type}`)
      })
      await secondGate.promise
      onReady(() => events.push('second-ready'))
      return 'second'
    })

    secondGate.resolve()
    await second
    firstGate.resolve()
    await first

    expect(events).toEqual([
      'second:paragraph',
      'second-ready',
      'first:paragraph',
      'first-ready',
    ])
  })

  test('restores an outer render context after a nested document', async () => {
    const events: string[] = []
    const outer = await executeDocument(async () => {
      onTransform(() => events.push('outer-transform-1'))
      await executeDocument(() => {
        onTransform(() => events.push('inner-transform'))
        return 'inner'
      })
      onTransform(() => events.push('outer-transform-2'))
      return 'outer'
    })

    expect(outer.children).toHaveLength(1)
    expect(events).toEqual([
      'inner-transform',
      'outer-transform-1',
      'outer-transform-2',
    ])
  })

  test('closes captured async contexts after the entry finishes', async () => {
    let inspectLate!: () => Promise<unknown>
    await executeDocument(() => {
      inspectLate = async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        try {
          onReady(() => {})
          return undefined
        } catch (error) {
          return error
        }
      }
      return 'done'
    })

    const error = await inspectLate()
    expect(error).toBeInstanceOf(MarkScriptRuntimeError)
    expect(error).toMatchObject({code: 'ERR1301'})
  })
})
