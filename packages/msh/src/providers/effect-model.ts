import {Effect, type Layer, Stream} from 'effect'
import {
  LanguageModel,
  Prompt,
  type Response,
  Tool,
  Toolkit,
} from 'effect/unstable/ai'
import type {
  Completion,
  Message,
  ModelRequest,
  Provider,
  ToolCall,
} from '../types.ts'
import {providerError} from './errors.ts'

export interface EffectModelOptions {
  identity?: Provider['identity']
  timeoutMs?: number
}

/** Select a fully provided model layer using the request's purpose and output limit. */
export function effectModel(
  model: (
    request: ModelRequest,
  ) => Layer.Layer<LanguageModel.LanguageModel, unknown>,
  options: EffectModelOptions = {},
): Provider {
  return {
    ...(options.identity ? {identity: options.identity} : {}),
    async complete(request, signal, emit) {
      const toolkit = Toolkit.make(
        ...request.tools.map(({function: tool}) =>
          Tool.dynamic(tool.name, {
            description: tool.description,
            parameters: tool.parameters,
          }),
        ),
      )
      const externalTools: Toolkit.WithHandler<typeof toolkit.tools> = {
        tools: toolkit.tools,
        handle: () =>
          Effect.die(new Error('Tool calls must be routed through msh')),
      }
      return Effect.runPromise(
        collectCompletion(
          LanguageModel.streamText({
            prompt: prompt(request.messages),
            toolkit: externalTools,
            disableToolCallResolution: true,
          }),
          emit,
        ).pipe(
          Effect.provide(model(request)),
          Effect.timeout(options.timeoutMs ?? 120_000),
          Effect.mapError(providerError),
          Effect.scoped,
        ),
        {signal},
      )
    },
  }
}

function decode(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function prompt(messages: Message[]): Prompt.Prompt {
  const names = new Map<string, string>()
  return Prompt.make(
    messages.map((message): Prompt.Message => {
      if (message.role === 'system')
        return Prompt.makeMessage('system', {content: message.content ?? ''})
      if (message.role === 'user')
        return Prompt.makeMessage('user', {
          content: [Prompt.makePart('text', {text: message.content ?? ''})],
        })
      if (message.role === 'tool') {
        const id = message.tool_call_id
        const name = id && names.get(id)
        if (!id || !name || message.content === null)
          throw new Error(
            'A tool result requires a preceding tool call and string content',
          )
        return Prompt.makeMessage('tool', {
          content: [
            Prompt.makePart('tool-result', {
              id,
              name,
              result: decode(message.content),
              isFailure: false,
              providerExecuted: false,
            }),
          ],
        })
      }
      const content: Prompt.AssistantMessagePart[] = []
      if (message.reasoning_content)
        content.push(
          Prompt.makePart('reasoning', {text: message.reasoning_content}),
        )
      if (message.content !== null)
        content.push(Prompt.makePart('text', {text: message.content}))
      for (const call of message.tool_calls ?? []) {
        names.set(call.id, call.function.name)
        content.push(
          Prompt.makePart('tool-call', {
            id: call.id,
            name: call.function.name,
            params: decode(call.function.arguments),
            providerExecuted: false,
          }),
        )
      }
      return Prompt.makeMessage('assistant', {content})
    }),
  )
}

function collectCompletion<E, R>(
  stream: Stream.Stream<Response.StreamPart<Record<string, Tool.Any>>, E, R>,
  emit: (text: string) => void,
) {
  return Effect.gen(function* () {
    let text = ''
    let reasoning = ''
    let finish: Response.FinishPart | undefined
    const calls: ToolCall[] = []
    yield* Stream.runForEach(stream, (part) =>
      Effect.try({
        try: () => {
          switch (part.type) {
            case 'text-delta':
              text += part.delta
              emit(part.delta)
              break
            case 'reasoning-delta':
              reasoning += part.delta
              break
            case 'tool-call':
              if (!part.id || !part.name || part.providerExecuted)
                throw new Error(
                  'Expected an identified tool call for msh to execute',
                )
              calls.push({
                id: part.id,
                type: 'function',
                function: {
                  name: part.name,
                  arguments: JSON.stringify(part.params),
                },
              })
              break
            case 'error':
              throw new Error('Provider reported a stream error')
            case 'tool-result':
              throw new Error('Tool results must be produced by msh')
            case 'finish':
              if (part.reason === 'error')
                throw new Error('Provider failed completion')
              finish = part
              break
          }
        },
        catch: (error) => error,
      }),
    )
    if (!finish)
      return yield* Effect.fail(
        new Error('Provider stream ended before completion'),
      )
    return {
      message: {
        role: 'assistant',
        content: text || null,
        ...(reasoning ? {reasoning_content: reasoning} : {}),
        ...(calls.length ? {tool_calls: calls} : {}),
      },
      finishReason: finish.reason.replaceAll('-', '_'),
      usage: {
        ...(finish.usage.inputTokens.total === undefined
          ? {}
          : {prompt_tokens: finish.usage.inputTokens.total}),
        ...(finish.usage.outputTokens.total === undefined
          ? {}
          : {completion_tokens: finish.usage.outputTokens.total}),
      },
    } satisfies Completion
  })
}
