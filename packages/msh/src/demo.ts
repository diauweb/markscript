import type {Provider} from './types.ts'
/** A deterministic provider that exercises emitted declarations and native tools. */
export function demoProvider(): Provider {
  let step = 0
  return {
    identity: {provider: 'local', model: 'scripted-demo'},
    async complete(request, signal, emit) {
      signal.throwIfAborted()
      if (request.purpose === 'approval')
        return {
          message: {
            role: 'assistant',
            content:
              '{"decision":"approve","reason":"Fixed local arithmetic demo action."}',
          },
          finishReason: 'stop',
        }
      const content =
        step === 0
          ? '/** Add two numbers. */\nexport function add(a: number, b: number): number {return a+b}\n\n{String(add(1, 1))}'
          : step === 2
            ? '20 + 22 = **42**. The emitted add function remains available as an ability.'
            : step > 2
              ? 'The demo is complete. Inspect the add ability or start another thread.'
              : ''
      const tool_calls =
        step === 1
          ? [
              {
                id: 'demo-add',
                type: 'function' as const,
                function: {
                  name: 'call',
                  arguments: '{"name":"add","arguments":{"a":20,"b":22}}',
                },
              },
            ]
          : undefined
      step++
      if (content) emit(content)
      return {
        message: {
          role: 'assistant',
          content,
          ...(tool_calls ? {tool_calls} : {}),
        },
        finishReason: tool_calls ? 'tool_calls' : 'stop',
      }
    },
  }
}
