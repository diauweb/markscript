/** @jsxImportSource ../src */
import {expect, test} from 'bun:test'
import {
  directiveAnnotation,
  jsx as directJsx,
  executeDocument,
  type MarkValue,
} from '../src/index.ts'

function Note({children}: {children?: unknown}): MarkValue {
  return (
    <blockquote>
      <strong>Note: </strong>
      {children}
    </blockquote>
  )
}

async function AsyncNote({children}: {children?: unknown}) {
  await Promise.resolve()
  return <blockquote>{children}</blockquote>
}

test('automatic JSX runtime and component typing produce MarkValues', async () => {
  const value = (
    <>
      {directiveAnnotation('ref', {id: 'intro', tags: ['public']})}
      <h2>Introduction</h2>
      <Note>
        Read{' '}
        <a href="/spec" title="Specification">
          the spec
        </a>
        .
      </Note>
      <AsyncNote>Later</AsyncNote>
      <img src="/diagram.png" alt="diagram" />
    </>
  )

  const root = await executeDocument(() => value)
  expect(root.children.map((node) => node.type)).toEqual([
    'heading',
    'blockquote',
    'blockquote',
    'paragraph',
  ])
})

// Static vocabulary/prop assertions are checked by the repository typecheck.
// biome-ignore lint/correctness/noConstantCondition: this unreachable block is a compile-time type fixture.
if (false) {
  // @ts-expect-error unknown lowercase intrinsics fall outside the Markdown vocabulary
  const invalidTag = <article />
  // @ts-expect-error image alt text is required
  // biome-ignore lint/a11y/useAltText: omitting alt is the type error under test.
  const invalidImage = <img src="/x.png" />
  // @ts-expect-error old directive element names are not compatibility aliases
  const invalidOldDirectiveElement = <block name="note" />
  // @ts-expect-error directives are source operators, not JSX intrinsics
  const invalidDirectiveElement = <section name="note">Content</section>

  function Count({count}: {count: number}): MarkValue {
    return String(count)
  }

  function Generic<Value>({value}: {value: Value}): MarkValue {
    return String(value)
  }

  const validComponent = directJsx(Count, {count: 1})
  const validGeneric = directJsx(Generic, {value: 1})

  // @ts-expect-error direct intrinsic calls require href
  directJsx('a', {children: 'missing href'})
  // @ts-expect-error direct component calls reject undeclared props
  directJsx(Count, {count: 1, extra: true})

  void invalidTag
  void invalidImage
  void invalidOldDirectiveElement
  void invalidDirectiveElement
  void validComponent
  void validGeneric
}
