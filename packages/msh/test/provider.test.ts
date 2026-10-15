import {expect, test} from 'bun:test'
import {chatCompletions, listModels} from '../src/providers/chat-completions.ts'
import {deepseekPreset} from '../src/providers/presets.ts'
import {frame} from './fixtures/chat-completions.ts'

function stream(source: string) {
  const bytes = new TextEncoder().encode(source)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3)
        controller.enqueue(bytes.slice(i, i + 3))
      controller.close()
    },
  })
}

test('SSE assembles UTF-8, reasoning and tool fragments, and rejects truncated completion', async () => {
  const source = (
    frame({
      choices: [{delta: {reasoning_content: 'Check it', content: '你好'}}],
    }) +
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {index: 0, id: 'a', function: {name: 'add', arguments: '{"a":'}},
            ],
          },
        },
      ],
    }) +
    frame({
      choices: [
        {
          delta: {tool_calls: [{index: 0, function: {arguments: '2}'}}]},
          finish_reason: 'tool_calls',
        },
      ],
    }) +
    frame({choices: [], usage: {prompt_tokens: 5, completion_tokens: 6}}) +
    'data: [DONE]\n\n'
  ).replaceAll('\n', '\r\n')
  const chunks: string[] = []
  const complete = (body: string, emit: (text: string) => void) =>
    chatCompletions(
      {baseURL: 'https://provider.test/v1', model: 'fixture'},
      async () =>
        new Response(stream(body), {
          headers: {'content-type': 'text/event-stream'},
        }),
    ).complete(
      {messages: [], tools: [], purpose: 'turn'},
      new AbortController().signal,
      emit,
    )
  const result = await complete(source, (text) => chunks.push(text))
  expect(chunks.join('')).toBe('你好')
  expect(result.message.reasoning_content).toBe('Check it')
  expect(result.message.tool_calls?.[0]?.function.arguments).toBe('{"a":2}')
  expect(result.usage?.prompt_tokens).toBe(5)
  await expect(
    complete(source.replace('data: [DONE]\r\n\r\n', ''), () => {}),
  ).rejects.toThrow('before completion')
})

test('DeepSeek adapter preserves reasoning history and sends the explicit Chat Completions contract', async () => {
  let body: Record<string, unknown> | undefined
  const fetcher = async (url: string, init: RequestInit) => {
    const request = new Request(url, init)
    expect(new URL(request.url).pathname).toBe('/chat/completions')
    expect(request.headers.get('authorization')).toBe('Bearer test-only')
    body = (await request.json()) as Record<string, unknown>
    return new Response(
      stream(
        frame({choices: [{delta: {content: 'ok'}, finish_reason: 'stop'}]}) +
          'data: [DONE]\n\n',
      ),
      {headers: {'content-type': 'text/event-stream'}},
    )
  }
  const provider = chatCompletions(
    {
      ...deepseekPreset,
      apiKey: 'test-only',
      baseURL: 'https://provider.test',
      model: 'fixture-model',
    },
    fetcher,
  )
  const messages = [
    {
      role: 'assistant' as const,
      content: 'Earlier',
      reasoning_content: 'retained reasoning',
    },
  ]
  await provider.complete(
    {messages, tools: [], purpose: 'compaction'},
    new AbortController().signal,
    () => {},
  )
  expect(body?.messages).toEqual(messages)
  expect(body?.thinking).toEqual({type: 'disabled'})
  expect(body?.model).toBe('fixture-model')
  expect(body?.tools).toBeUndefined()
})

test('generic Chat Completions omits preset fields and supports authless endpoints and model discovery', async () => {
  const requests: {url: string; init: RequestInit}[] = []
  const fetcher = async (url: string, init: RequestInit) => {
    requests.push({url, init})
    if (url.endsWith('/models'))
      return Response.json({data: [{id: 'local-model'}]})
    return new Response(
      stream(
        frame({choices: [{delta: {content: 'ok'}, finish_reason: 'stop'}]}) +
          'data: [DONE]\n\n',
      ),
    )
  }
  const options = {baseURL: 'http://localhost:1234/v1/', model: 'local-model'}
  expect(await listModels(options, fetcher)).toEqual(['local-model'])
  await chatCompletions(options, fetcher).complete(
    {
      messages: [
        {
          role: 'assistant',
          content: 'earlier',
          reasoning_content: 'private reasoning',
        },
      ],
      tools: [],
      purpose: 'turn',
      maxOutputTokens: 64,
    },
    new AbortController().signal,
    () => {},
  )
  expect(requests[1]?.url).toBe('http://localhost:1234/v1/chat/completions')
  const body = await new Response(requests[1]?.init.body).json()
  expect(body.messages).toEqual([{role: 'assistant', content: 'earlier'}])
  expect(body.max_tokens).toBe(64)
  expect(body.thinking).toBeUndefined()
  expect(new Headers(requests[1]?.init.headers).has('authorization')).toBe(
    false,
  )
  await expect(
    listModels(
      options,
      async () => new Response('echoed-secret', {status: 401}),
    ),
  ).rejects.toThrow('authentication rejected')
  await expect(
    listModels(
      options,
      async () => new Response('echoed-secret', {status: 500}),
    ),
  ).rejects.not.toThrow('echoed-secret')
})

test('Effect cancels streaming bodies on interruption and timeout', async () => {
  for (const mode of ['cancel', 'timeout'] as const) {
    const entered = Promise.withResolvers<void>()
    const controller = new AbortController()
    let closed = 0
    const provider = chatCompletions(
      {
        baseURL: 'https://provider.test',
        model: 'fixture',
        timeoutMs: mode === 'timeout' ? 30 : 5000,
      },
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(
                new TextEncoder().encode(
                  frame({choices: [{delta: {content: 'partial'}}]}),
                ),
              )
            },
            cancel() {
              closed++
            },
          }),
        ),
    )
    const result = provider
      .complete(
        {messages: [], tools: [], purpose: 'turn'},
        controller.signal,
        () => entered.resolve(),
      )
      .then(
        () => null,
        (error: unknown) => error,
      )
    await entered.promise
    if (mode === 'cancel') controller.abort(new Error('Cancelled'))
    expect(await result).toBeInstanceOf(Error)
    expect(closed).toBe(1)
  }
})

test('Effect request transforms omit unsupported usage options and sanitize provider errors', async () => {
  const key = 'fixture-secret'
  let body: Record<string, unknown> | undefined
  const provider = chatCompletions(
    {
      baseURL: 'https://provider.test',
      model: 'fixture',
      apiKey: key,
      includeUsage: false,
    },
    async (_url, request) => {
      body = await new Response(request.body).json()
      return new Response(JSON.stringify({error: {message: key}}), {
        status: 401,
      })
    },
  )
  const error = await provider
    .complete(
      {messages: [], tools: [], purpose: 'turn'},
      new AbortController().signal,
      () => {},
    )
    .then(
      () => '',
      (error: unknown) => String(error),
    )
  expect(body?.stream).toBe(true)
  expect(body?.stream_options).toBeUndefined()
  expect(error).toContain('authentication rejected')
  expect(error).not.toContain(key)
})

test('invalid envelopes, provider stream errors and incomplete tool calls fail completion', async () => {
  const incomplete = frame({
    choices: [
      {
        delta: {
          tool_calls: [{index: 0, function: {name: 'add', arguments: '{}'}}],
        },
        finish_reason: 'tool_calls',
      },
    ],
  })
  for (const [source, message] of [
    ['data: {"choices":"invalid"}\n\n', 'invalid Chat Completions event'],
    [
      'data: {"error":{"message":"provider failed"}}\n\n',
      'Provider reported a stream error',
    ],
    [incomplete, 'Incomplete tool call'],
  ]) {
    const provider = chatCompletions(
      {baseURL: 'https://provider.test', model: 'fixture'},
      async () => new Response(`${source}data: [DONE]\n\n`),
    )
    await expect(
      provider.complete(
        {messages: [], tools: [], purpose: 'turn'},
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(message)
  }
})
