import {expect, test} from 'bun:test'
import {
  directiveFromMarkdown,
  directiveToMarkdown,
  type LeafDirective,
} from '@markscript/mdast-util-mdx-directive'
import {directive} from '@markscript/micromark-extension-mdx-directive'
import * as acorn from 'acorn'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {toMarkdown} from 'mdast-util-to-markdown'
import remarkParse from 'remark-parse'
import {unified} from 'unified'
import remarkDirective from '../src/index.ts'

const options = {}

test('the micromark and mdast forks preserve ordered expression attributes', () => {
  const tree = fromMarkdown(
    "::box{plain=hello enabled options={{style: 'Title'}} {...rest}}",
    {
      extensions: [directive(options)],
      mdastExtensions: [directiveFromMarkdown()],
    },
  )
  const node = tree.children[0] as LeafDirective

  expect(node.attributes).toEqual({plain: 'hello', enabled: ''})
  expect(node.directiveAttributes).toEqual([
    expect.objectContaining({
      type: 'mdxJsxAttribute',
      name: 'plain',
      value: 'hello',
    }),
    expect.objectContaining({
      type: 'mdxJsxAttribute',
      name: 'enabled',
      value: null,
    }),
    expect.objectContaining({
      type: 'mdxJsxAttribute',
      name: 'options',
      value: expect.objectContaining({
        type: 'mdxJsxAttributeValueExpression',
        value: "{style: 'Title'}",
      }),
    }),
    expect.objectContaining({
      type: 'mdxJsxExpressionAttribute',
      value: '...rest',
    }),
  ])
  expect(toMarkdown(tree, {extensions: [directiveToMarkdown()]}).trim()).toBe(
    '::box{plain="hello" enabled options={{style: \'Title\'}} {...rest}}',
  )
})

test('the remark fork composes the tokenizer and mdast extensions', () => {
  const tree = unified()
    .use(remarkParse)
    .use(remarkDirective, options)
    .parse('::box{value={input ?? 0}}')
  const node = tree.children[0] as LeafDirective
  const value = node.directiveAttributes?.[0]

  expect(value).toMatchObject({
    type: 'mdxJsxAttribute',
    name: 'value',
    value: {
      type: 'mdxJsxAttributeValueExpression',
      value: 'input ?? 0',
    },
  })
})

test.each([
  [':box[label]{value={input ?? 0} {...rest}}', 'textDirective'],
  ['::box[label]{value={input ?? 0} {...rest}}', 'leafDirective'],
  [
    ':::box[label]{value={input ?? 0} {...rest}}\nbody\n:::',
    'containerDirective',
  ],
])('parses expression ASTs and spreads in %s', (source, type) => {
  const tree = unified()
    .use(remarkParse)
    .use(remarkDirective, {acorn, addResult: true})
    .parse(source)
  const first = tree.children[0]
  const node = first?.type === 'paragraph' ? first.children[0] : first

  expect(node).toMatchObject({
    type,
    name: 'box',
    directiveAttributes: [
      {
        type: 'mdxJsxAttribute',
        name: 'value',
        value: {
          value: 'input ?? 0',
          data: {estree: {type: 'Program'}},
        },
      },
      {
        type: 'mdxJsxExpressionAttribute',
        value: '...rest',
        data: {estree: {type: 'Program'}},
      },
    ],
  })
  expect(() =>
    unified()
      .use(remarkParse)
      .use(remarkDirective, {acorn, acornOptions: {ecmaVersion: 2019}})
      .parse(source),
  ).toThrow()
})

test('leaves escaped and adjacent colons as text', () => {
  for (const source of [String.raw`\:box`, 'x::box']) {
    const tree = unified().use(remarkParse).use(remarkDirective).parse(source)
    expect(tree.children).toMatchObject([
      {
        type: 'paragraph',
        children: [{type: 'text', value: source.replace('\\:', ':')}],
      },
    ])
  }
})

test('backtracks incomplete attributes without discarding the directive', () => {
  const tree = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .parse(':box{unfinished="')
  expect(tree.children).toMatchObject([
    {
      type: 'paragraph',
      children: [
        {type: 'textDirective', name: 'box', attributes: {}},
        {type: 'text', value: '{unfinished="'},
      ],
    },
  ])
})
