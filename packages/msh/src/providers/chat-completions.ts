import {OpenAiClient} from '@effect/ai-openai-compat'
import {Effect, Layer, Redacted, Schema, Stream} from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from 'effect/unstable/http'
import type {
  Completion,
  JsonObject,
  ModelRequest,
  Provider,
  ToolCall,
} from '../types.ts'
import {providerError} from './errors.ts'

export interface ChatCompletionsOptions {
  baseURL: string
  model: string
  provider?: string
  apiKey?: string
  /** Provider-specific fields, followed by purpose-specific overrides. */
  extraBody?: JsonObject
  compactionBody?: JsonObject
  preserveReasoning?: boolean
  includeUsage?: boolean
  timeoutMs?: number
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export function endpoint(baseURL: string, resource: string): string {
  const url = new URL(baseURL)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Provider base URL must be an HTTP(S) URL without credentials, query or fragment',
    )
  return `${url.href.replace(/\/$/u, '')}/${resource}`
}

function clientLayer(
  options: Pick<ChatCompletionsOptions, 'baseURL' | 'apiKey' | 'includeUsage'>,
) {
  if (
    options.apiKey !== undefined &&
    (!options.apiKey || /\s/u.test(options.apiKey))
  )
    throw new Error('The API key must be nonempty and contain no whitespace')
  return OpenAiClient.layer({
    apiUrl: endpoint(options.baseURL, '').replace(/\/$/u, ''),
    apiKey:
      options.apiKey === undefined ? undefined : Redacted.make(options.apiKey),
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) => {
        // The SDK requests usage by default; some compatible servers reject that field.
        if (
          options.includeUsage === false &&
          request.body._tag === 'Uint8Array'
        ) {
          const body = JSON.parse(new TextDecoder().decode(request.body.body))
          delete body.stream_options
          return HttpClientRequest.bodyJsonUnsafe(request, body)
        }
        return request
      }),
  }).pipe(Layer.provide(FetchHttpClient.layer))
}

function run<A>(
  operation: Effect.Effect<A, unknown, OpenAiClient.OpenAiClient>,
  layer: ReturnType<typeof clientLayer>,
  fetcher: Fetcher,
  signal: AbortSignal,
) {
  const fetch: typeof globalThis.fetch = ((url, init) =>
    fetcher(String(url), init ?? {})) as typeof globalThis.fetch
  return Effect.runPromise(
    operation.pipe(
      Effect.provide(layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provideService(FetchHttpClient.RequestInit, {redirect: 'error'}),
      Effect.mapError(providerError),
      Effect.scoped,
    ),
    {signal},
  )
}

const jsonObject = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Json),
)

function payload(
  options: ChatCompletionsOptions,
  request: ModelRequest,
): OpenAiClient.ChatCompletionRequest {
  return {
    ...options.extraBody,
    ...(request.purpose === 'compaction' ? options.compactionBody : {}),
    model: options.model,
    messages: request.messages.map(({reasoning_content, ...message}) => {
      if (message.role === 'tool') {
        if (!message.tool_call_id || typeof message.content !== 'string')
          throw new Error(
            'A tool result requires tool_call_id and string content',
          )
        return {
          role: 'tool',
          tool_call_id: message.tool_call_id,
          content: message.content,
        }
      }
      return options.preserveReasoning && reasoning_content !== undefined
        ? {...message, role: message.role, reasoning_content}
        : {...message, role: message.role}
    }),
    tools: request.tools.length
      ? request.tools.map((tool) => ({
          ...tool,
          function: {
            ...tool.function,
            parameters: jsonObject(tool.function.parameters),
          },
        }))
      : undefined,
    tool_choice: request.tools.length ? 'auto' : undefined,
    max_tokens: request.maxOutputTokens ?? 8192,
  }
}

/** Effect owns HTTP, authentication, SSE framing and cancellation; msh assembles one completion. */
export function chatCompletions(
  options: ChatCompletionsOptions,
  fetcher: Fetcher = fetch,
): Provider {
  if (!options.model.trim()) throw new Error('A model is required')
  const layer = clientLayer(options)
  return {
    identity: {
      model: options.model,
      ...(options.provider ? {provider: options.provider} : {}),
    },
    async complete(request, signal, emit) {
      return run(
        Effect.gen(function* () {
          const client = yield* OpenAiClient.OpenAiClient
          const [, stream] = yield* client.createResponseStream(
            payload(options, request),
          )
          return yield* collectCompletion(stream, emit)
        }).pipe(Effect.timeout(options.timeoutMs ?? 120_000)),
        layer,
        fetcher,
        signal,
      )
    },
  }
}

/** Read-only credential validation and discovery; it never generates a completion. */
export async function listModels(
  options: Pick<ChatCompletionsOptions, 'baseURL' | 'apiKey'>,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  return run(
    Effect.gen(function* () {
      const client = yield* OpenAiClient.OpenAiClient
      const response = yield* HttpClient.filterStatusOk(client.client).get(
        '/models',
      )
      const body = yield* response.json
      const decoded = yield* Schema.decodeUnknownEffect(
        Schema.Struct({data: Schema.Array(Schema.Struct({id: Schema.String}))}),
      )(body).pipe(
        Effect.mapError(
          () => new Error('Provider returned an invalid model list'),
        ),
      )
      return [...new Set(decoded.data.map((model) => model.id))].sort()
    }).pipe(Effect.timeout(15_000)),
    clientLayer(options),
    fetcher,
    new AbortController().signal,
  )
}

function collectCompletion<E>(
  stream: Stream.Stream<OpenAiClient.ChatCompletionStreamEvent, E>,
  emit: (text: string) => void,
) {
  return Effect.gen(function* () {
    let text = ''
    let reasoning = ''
    let finishReason = ''
    let done = false
    let usage: Completion['usage']
    const calls = new Map<number, ToolCall>()
    yield* Stream.runForEach(stream, (event) =>
      Effect.try({
        try: () => {
          if (event === '[DONE]') {
            done = true
            return
          }
          if ('_tag' in event) {
            if (
              event.data &&
              typeof event.data === 'object' &&
              'error' in event.data
            )
              throw new Error('Provider reported a stream error')
            throw new Error(
              'Provider returned an invalid Chat Completions event',
            )
          }
          if (event.usage)
            usage = {
              prompt_tokens: event.usage.prompt_tokens,
              completion_tokens: event.usage.completion_tokens,
            }
          const choice = event.choices.find((choice) => choice.index === 0)
          if (!choice) return
          if (choice.finish_reason) finishReason = choice.finish_reason
          const delta = choice.delta
          if (delta?.content) {
            text += delta.content
            emit(delta.content)
          }
          if (delta?.reasoning_content) reasoning += delta.reasoning_content
          for (const part of delta?.tool_calls ?? []) {
            if (part.index === undefined || part.index < 0)
              throw new Error('Invalid streamed tool-call index')
            const call = calls.get(part.index) ?? {
              id: '',
              type: 'function',
              function: {name: '', arguments: ''},
            }
            if (part.id) call.id += part.id
            if (part.function?.name) call.function.name += part.function.name
            if (part.function?.arguments)
              call.function.arguments += part.function.arguments
            calls.set(part.index, call)
          }
        },
        catch: (error) => error,
      }),
    )
    return yield* Effect.try({
      try: (): Completion => {
        if (!done || !finishReason)
          throw new Error('Chat Completions stream ended before completion')
        const toolCalls = [...calls]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => call)
        if (toolCalls.some((call) => !call.id || !call.function.name))
          throw new Error('Incomplete tool call')
        return {
          message: {
            role: 'assistant',
            content: text || null,
            ...(reasoning ? {reasoning_content: reasoning} : {}),
            ...(toolCalls.length ? {tool_calls: toolCalls} : {}),
          },
          finishReason,
          ...(usage ? {usage} : {}),
        }
      },
      catch: (error) => error,
    })
  })
}
