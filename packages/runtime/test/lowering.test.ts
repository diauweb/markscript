import {describe, expect, test} from 'bun:test'
import type {MarkValue} from '../src/index.ts'
import {
  directiveAnnotation,
  directiveGroup,
  Fragment,
  jsx,
  lowerToRoot,
  MarkScriptRuntimeError,
  validateNodeForContext,
  validateRoot,
} from '../src/index.ts'

function errorCode(action: () => unknown): string | undefined {
  try {
    action()
    return undefined
  } catch (error) {
    expect(error).toBeInstanceOf(MarkScriptRuntimeError)
    return (error as MarkScriptRuntimeError).code
  }
}

// Runtime-negative fixtures deliberately cross the static JSX call boundary.
const uncheckedJsx = jsx as (
  type: unknown,
  props: Record<string, unknown> | null,
  key?: unknown,
) => MarkValue

describe('MarkValue lowering', () => {
  test('normalizes scalars, empty values, nested arrays, and fragments', () => {
    const root = lowerToRoot([
      'alpha',
      null,
      false,
      [2, undefined],
      jsx(Fragment, {children: 'omega'}),
    ])

    expect(root).toEqual({
      type: 'root',
      children: [
        {type: 'paragraph', children: [{type: 'text', value: 'alpha'}]},
        {type: 'paragraph', children: [{type: 'text', value: '2'}]},
        {type: 'paragraph', children: [{type: 'text', value: 'omega'}]},
      ],
    })
  })

  test('resolves synchronous components during direct lowering', () => {
    function Label({children}: {children?: unknown}) {
      return jsx('strong', {children})
    }
    async function AsyncLabel() {
      return 'later'
    }

    expect(lowerToRoot(jsx(Label, {children: 'now'}))).toMatchObject({
      children: [{type: 'paragraph', children: [{type: 'strong'}]}],
    })
    expect(errorCode(() => lowerToRoot(jsx(AsyncLabel, {})))).toBe('ERR1103')
  })

  test('supports inline and block code without stringifying markup', () => {
    const inline = jsx('p', {
      children: jsx('code', {
        children: ['const x = ', 3, {type: 'text', value: ';'}],
      }),
    })
    const block = jsx('pre', {
      children: jsx('code', {children: ['line 1\n', 'line 2']}),
    })

    expect(lowerToRoot([inline, block])).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{type: 'inlineCode', value: 'const x = 3;'}],
        },
        {type: 'code', value: 'line 1\nline 2'},
      ],
    })
    expect(
      errorCode(() => lowerToRoot(jsx('pre', {children: 'not code'}))),
    ).toBe('ERR1104')
    expect(
      errorCode(() =>
        lowerToRoot(
          jsx('p', {
            children: jsx('code', {children: jsx('strong', {children: 'x'})}),
          }),
        ),
      ),
    ).toBe('ERR1104')
  })

  test('flattens directive groups and annotates each emitted child', () => {
    const root = lowerToRoot([
      directiveGroup('callout', {tone: 'warning'}, [
        jsx('h2', {children: 'Release'}),
        jsx('p', {children: 'Ready'}),
      ]),
    ])

    expect(root.children).toHaveLength(2)
    expect(root.children[0]).toMatchObject({
      type: 'heading',
      data: {callout: {tone: 'warning'}},
    })
    expect(root.children[1]).toMatchObject({
      type: 'paragraph',
      data: {callout: {tone: 'warning'}},
    })
  })

  test('enforces flow, phrasing, and list contexts', () => {
    expect(
      lowerToRoot(jsx('ul', {children: jsx('li', {children: 'one'})})),
    ).toHaveProperty('children.0.children.0.children.0.type', 'paragraph')
    expect(
      errorCode(() =>
        lowerToRoot(jsx('p', {children: jsx('h2', {children: 'nested'})})),
      ),
    ).toBe('ERR1104')
    expect(lowerToRoot(jsx('strong', {children: 'top'}))).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {type: 'strong', children: [{type: 'text', value: 'top'}]},
          ],
        },
      ],
    })
    expect(
      errorCode(() =>
        lowerToRoot(jsx('ul', {children: jsx('p', {children: 'x'})})),
      ),
    ).toBe('ERR1104')
    expect(
      errorCode(() =>
        lowerToRoot(
          jsx('a', {
            href: '/outer',
            children: jsx('a', {href: '/inner', children: 'nested'}),
          }),
        ),
      ),
    ).toBe('ERR1104')
    expect(errorCode(() => lowerToRoot(jsx('li', {children: 'orphan'})))).toBe(
      'ERR1104',
    )
  })

  test('rejects unsupported tags, attributes, keys, and invalid prop types', () => {
    expect(errorCode(() => uncheckedJsx('article', {children: 'x'}))).toBe(
      'ERR1101',
    )
    expect(errorCode(() => uncheckedJsx('block', {name: 'note'}))).toBe(
      'ERR1101',
    )
    expect(
      errorCode(() => lowerToRoot(uncheckedJsx('div', {children: 'x'}))),
    ).toBe('ERR1101')
    expect(errorCode(() => uncheckedJsx('p', {children: 'x'}, 'key'))).toBe(
      'ERR1102',
    )
    expect(
      errorCode(() =>
        lowerToRoot(uncheckedJsx('h2', {className: 'red', children: 'x'})),
      ),
    ).toBe('ERR1102')
    expect(
      errorCode(() =>
        lowerToRoot(
          jsx('p', {
            children: uncheckedJsx('a', {href: 1, children: 'x'}),
          }),
        ),
      ),
    ).toBe('ERR1102')
    expect(
      errorCode(() => lowerToRoot(jsx('ol', {start: 1.5, children: []}))),
    ).toBe('ERR1102')
    expect(
      errorCode(() => lowerToRoot(uncheckedJsx('hr', {children: 'not void'}))),
    ).toBe('ERR1102')
  })

  test('rejects implicit stringification of unsupported runtime values', () => {
    expect(errorCode(() => lowerToRoot(true))).toBe('ERR1103')
    expect(errorCode(() => lowerToRoot({} as MarkValue))).toBe('ERR1103')
    expect(
      errorCode(() =>
        lowerToRoot(Promise.resolve('x') as unknown as MarkValue),
      ),
    ).toBe('ERR1103')
  })
})

describe('directive attachments', () => {
  test('merges namespaces shallowly and attaches to the next emitted node', () => {
    const root = lowerToRoot([
      directiveAnnotation('ref', {id: 'intro', tags: ['public']}),
      false,
      directiveAnnotation('style', {color: 'accent'}),
      directiveAnnotation('style', {color: 'blue', indent: 2}),
      jsx('h2', {children: 'Introduction'}),
    ])

    expect(root.children[0]?.data).toEqual({
      ref: {id: 'intro', tags: ['public']},
      style: {color: 'blue', indent: 2},
    })
  })

  test('keeps attachment queues local to each sequence', () => {
    const root = lowerToRoot([
      directiveAnnotation('style', {role: 'heading'}),
      jsx('h2', {
        children: [
          directiveAnnotation('ref', {id: 'word'}),
          jsx('strong', {children: 'Title'}),
        ],
      }),
    ])

    const heading = root.children[0]
    expect(heading?.data).toEqual({style: {role: 'heading'}})
    expect(heading).toHaveProperty('children.0.data', {ref: {id: 'word'}})
  })

  test('preserves existing node metadata and rejects namespace collisions', () => {
    const paragraph = {
      type: 'paragraph' as const,
      data: {style: {role: 'existing'}, library: {keep: true}},
      children: [{type: 'text' as const, value: 'x'}],
    }
    const root = lowerToRoot([
      directiveAnnotation('style', {color: 'accent'}),
      paragraph,
    ])
    expect(root.children[0]?.data).toEqual({
      style: {role: 'existing', color: 'accent'},
      library: {keep: true},
    })

    expect(
      errorCode(() =>
        lowerToRoot([
          directiveAnnotation('ref', {id: 'x'}),
          {
            type: 'paragraph',
            data: {ref: 'occupied'},
            children: [{type: 'text', value: 'x'}],
          } as MarkValue,
        ]),
      ),
    ).toBe('ERR1105')
  })

  test('defines prototype-looking keys safely', () => {
    const annotation = directiveAnnotation('__proto__', {polluted: true})
    const root = lowerToRoot([annotation, jsx('h1', {children: 'safe'})])
    const data = root.children[0]?.data as Record<string, unknown>
    expect(Object.hasOwn(data, '__proto__')).toBe(true)
    expect(({} as {polluted?: boolean}).polluted).toBeUndefined()
  })

  test('rejects removed JSX syntax and dangling attachments', () => {
    expect(errorCode(() => uncheckedJsx('x-ref', {}))).toBe('ERR1101')
    expect(
      errorCode(() => lowerToRoot(directiveAnnotation('ref', {id: 'lost'}))),
    ).toBe('ERR1105')
    expect(
      errorCode(() =>
        lowerToRoot(
          jsx('h2', {
            children: ['title', directiveAnnotation('ref', {id: 'dangling'})],
          }),
        ),
      ),
    ).toBe('ERR1105')

    const frozen = Object.freeze({
      type: 'paragraph' as const,
      children: [{type: 'text' as const, value: 'immutable'}],
    })
    expect(
      errorCode(() =>
        lowerToRoot([directiveAnnotation('ref', {id: 'x'}), frozen]),
      ),
    ).toBe('ERR1105')
  })
})

describe('direct MDAST validation', () => {
  test('accepts standard MDAST including tables and root fragments', () => {
    const fragment = {
      type: 'root' as const,
      data: {ref: {id: 'fragment'}},
      children: [
        {
          type: 'table' as const,
          align: ['left' as const],
          children: [
            {
              type: 'tableRow' as const,
              children: [
                {
                  type: 'tableCell' as const,
                  children: [{type: 'text' as const, value: 'cell'}],
                },
              ],
            },
          ],
        },
      ],
    }
    const root = lowerToRoot(fragment)
    expect(root).toBe(fragment)
  })

  test('detaches frozen roots when composing a mutable parent tree', () => {
    const paragraph = {
      type: 'paragraph' as const,
      children: [{type: 'text' as const, value: 'imported'}],
      data: {library: {source: 'section.ms'}},
    }
    const fragment = Object.freeze({
      type: 'root' as const,
      children: Object.freeze([
        Object.freeze({
          ...paragraph,
          children: Object.freeze(paragraph.children),
          data: Object.freeze({
            library: Object.freeze({source: 'section.ms'}),
          }),
        }),
      ]),
    })

    const root = lowerToRoot([fragment as unknown as MarkValue])
    const child = root.children[0]
    expect(child).not.toBe(fragment.children[0])
    expect(child?.data).toEqual({library: {source: 'section.ms'}})
    expect(Object.isFrozen(child)).toBe(false)
    if (child !== undefined) child.data = {...child.data, transformed: true}
    expect(child?.data?.transformed).toBe(true)
  })

  test('rejects invalid fields, unknown nodes, and misplaced nodes', () => {
    expect(
      errorCode(() =>
        lowerToRoot({
          type: 'heading',
          depth: 7,
          children: [],
        } as unknown as MarkValue),
      ),
    ).toBe('ERR1201')
    expect(
      errorCode(() => lowerToRoot({type: 'custom'} as unknown as MarkValue)),
    ).toBe('ERR1201')
    expect(
      errorCode(() =>
        lowerToRoot(
          jsx('p', {
            children: {type: 'break', children: []} as unknown as MarkValue,
          }),
        ),
      ),
    ).toBe('ERR1201')
    expect(
      errorCode(() =>
        lowerToRoot(
          jsx('p', {children: {type: 'thematicBreak'} as unknown as MarkValue}),
        ),
      ),
    ).toBe('ERR1104')
  })

  test('rejects cyclic and shared AST child nodes', () => {
    const cycle: {type: 'paragraph'; children: unknown[]} = {
      type: 'paragraph',
      children: [],
    }
    cycle.children.push(cycle)
    expect(errorCode(() => lowerToRoot(cycle as unknown as MarkValue))).toBe(
      'ERR1202',
    )

    const text = {type: 'text' as const, value: 'same'}
    const shared = {
      type: 'root' as const,
      children: [
        {type: 'paragraph' as const, children: [text]},
        {type: 'paragraph' as const, children: [text]},
      ],
    }
    expect(errorCode(() => validateRoot(shared))).toBe('ERR1202')
  })
})

test.each(['strong', 'emphasis', 'delete', 'textDirective'])(
  'rejects descendant links through %s while allowing links outside a link',
  (wrapper) => {
    const link = (type: string, children: unknown[]) =>
      type === 'link'
        ? {type, url: '/target', children}
        : {type, identifier: 'target', referenceType: 'full', children}
    const wrap = (child: unknown) => ({
      type: wrapper,
      ...(wrapper === 'textDirective' ? {name: 'mark', attributes: {}} : {}),
      children: [child],
    })
    for (const outer of ['link', 'linkReference']) {
      for (const inner of ['link', 'linkReference']) {
        const child = wrap(link(inner, [{type: 'text', value: 'Nested'}]))
        const root = {
          type: 'root',
          children: [{type: 'paragraph', children: [link(outer, [child])]}],
        }
        expect(errorCode(() => validateRoot(root))).toBe('ERR1104')
        expect(
          errorCode(() => validateNodeForContext(child, 'link', '$')),
        ).toBe('ERR1104')
        expect(() =>
          validateRoot({
            type: 'root',
            children: [{type: 'paragraph', children: [child]}],
          }),
        ).not.toThrow()
      }
    }
    expect(
      errorCode(() =>
        lowerToRoot(
          jsx('a', {
            href: '/outer',
            children: jsx('strong', {
              children: jsx('a', {href: '/inner', children: 'Nested'}),
            }),
          }),
        ),
      ),
    ).toBe('ERR1104')
  },
)
