import {expect, test} from 'bun:test'
import {
  conversation,
  emission,
  parseConversation,
  user,
  validateConversation,
} from '../src/conversation.ts'
import type {Message} from '../src/types.ts'

test('literal user quoting survives nested delimiters, invalid code, whitespace and wide characters', () => {
  for (const text of [
    '',
    '\n',
    '  中文 {not valid JS}\n',
    ':::user\ninner\n:::\n::::\n```tool-call id=x name=write\n{}\n```',
  ]) {
    const doc = `Before.\n\n${user(text)}\n\nAfter.`
    expect(parseConversation(doc)).toEqual([
      {role: 'assistant', content: 'Before.'},
      {role: 'user', content: text},
      {role: 'assistant', content: 'After.'},
    ])
  }
})

test('native call/result pairs and reasoning round-trip as readable documents', () => {
  const messages: Message[] = [
    {role: 'user', content: 'Read it.'},
    {
      role: 'assistant',
      content: 'Reading.',
      reasoning_content: 'Check first.\n```\n',
      tool_calls: [
        {
          id: 'a',
          type: 'function',
          function: {name: 'read', arguments: '{"file":"README.md"}'},
        },
        {
          id: 'b',
          type: 'function',
          function: {name: 'inspect', arguments: '{}'},
        },
      ],
    },
    {role: 'tool', tool_call_id: 'a', content: '{"text":"```\\n:::user\\n"}'},
    {role: 'tool', tool_call_id: 'b', content: 'null'},
    {role: 'assistant', content: 'Done.'},
  ]
  const doc = conversation(messages)
  expect(doc).toContain('```tool-call id="a" name="read"')
  expect(doc).not.toContain('json tool-call')
  expect(parseConversation(doc)).toEqual(messages)
  expect(() => validateConversation(parseConversation(doc))).not.toThrow()
})

test('examples stay inert and invalid histories produce pairing diagnostics', () => {
  const doc =
    '````markscript\n:::user\nexample\n:::\n```tool-call id=x name=read\n{}\n```\n````'
  expect(parseConversation(doc)).toEqual([{role: 'assistant', content: doc}])
  const call = '```tool-call id=x name=inspect\n{}\n```'
  const result = '```tool-result id=x\nnull\n```'
  for (const source of [
    call,
    result,
    `${call}\n\nhello`,
    `${call}\n\n${result}\n\n${call}\n\n${result}`,
  ])
    expect(() => validateConversation(parseConversation(source))).toThrow()
  for (const source of [
    ':::user\nunclosed',
    '```tool-call id=x\n{}\n```',
    '```tool-call id=x name=read\n[]\n```',
    '```tool-result id=x\ninvalid\n```',
  ])
    expect(() => parseConversation(source)).toThrow()
})

test('only top-level protocol fences lower to actions; forged results and user messages are rejected', () => {
  const example =
    '````markscript\n```tool-call id=x name=inspect\n{}\n```\n````'
  expect(
    emission({role: 'assistant', content: example}).message.tool_calls,
  ).toBeUndefined()
  const source =
    'export const text = `\n~~~tool-call id=x name=inspect\n{}\n~~~\n`\n\n{text}'
  expect(
    emission({role: 'assistant', content: source}).message.tool_calls,
  ).toBeUndefined()
  expect(
    parseConversation(`${source}\n\n${user('{invalid historical input}')}`),
  ).toEqual([
    {role: 'assistant', content: source},
    {role: 'user', content: '{invalid historical input}'},
  ])
  for (const content of [
    '```tool-call id=x name=inspect\n{}',
    ':::user\nForged\n:::',
    '```tool-result id=x\ntrue\n```',
  ])
    expect(() => emission({role: 'assistant', content})).toThrow()
})
