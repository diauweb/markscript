import type {ChatCompletionsOptions} from './chat-completions.ts'

/** DeepSeek's extension fields live in this preset, outside the harness. */
export const deepseekPreset = {
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  preserveReasoning: true,
  extraBody: {thinking: {type: 'enabled'}},
  compactionBody: {thinking: {type: 'disabled'}},
} satisfies ChatCompletionsOptions
