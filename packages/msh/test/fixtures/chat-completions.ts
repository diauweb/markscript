import type {OpenAiClient} from '@effect/ai-openai-compat'

/** Canonical API envelopes keep HTTP fixtures on the provider's wire contract. */
export function frame(data: {
  choices: (Omit<OpenAiClient.ChatCompletionChoice, 'index'> & {
    index?: number
  })[]
  usage?: {prompt_tokens: number; completion_tokens: number}
}) {
  return `data: ${JSON.stringify({
    id: 'fixture-completion',
    object: 'chat.completion.chunk',
    model: 'fixture-model',
    created: 1,
    choices: data.choices.map((choice) => ({index: 0, ...choice})),
    ...(data.usage
      ? {
          usage: {
            ...data.usage,
            total_tokens:
              data.usage.prompt_tokens + data.usage.completion_tokens,
          },
        }
      : {}),
  })}\n\n`
}
