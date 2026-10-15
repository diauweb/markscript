import type {ToolDefinition} from './types.ts'

const string = {type: 'string'}
const parts = {
  type: 'array',
  items: {
    anyOf: [
      string,
      {
        type: 'object',
        properties: {module: string, input: {}},
        required: ['module'],
        additionalProperties: false,
      },
    ],
  },
}
const context = {
  type: 'object',
  properties: {
    instructions: {
      ...parts,
      items: {
        anyOf: [
          ...parts.items.anyOf,
          {
            type: 'object',
            properties: {text: string},
            required: ['text'],
            additionalProperties: false,
          },
        ],
      },
    },
    messages: parts,
  },
  required: ['instructions', 'messages'],
  additionalProperties: false,
}
const definitions = [
  [
    'spawn',
    'Start a child with separate instructions and conversation documents, or a JS/TS code module default entry.',
    {
      target: {
        anyOf: [
          context,
          {
            type: 'object',
            properties: {module: string},
            required: ['module'],
            additionalProperties: false,
          },
        ],
      },
    },
    ['target'],
  ],
  [
    'send',
    'Queue inert conversation documents for threads. Quote incoming text with :::user. Target descendants broadcasts below the sender. Reserved controls interrupt or terminate immediately.',
    {
      target: {anyOf: [string, {type: 'array', items: string}]},
      message: {
        anyOf: [
          string,
          parts,
          {
            type: 'object',
            properties: {control: {enum: ['interrupt', 'terminate']}},
            required: ['control'],
            additionalProperties: false,
          },
        ],
      },
    },
    ['target', 'message'],
  ],
  [
    'inspect',
    'Read state, active context documents, complete/recent history, native tools, and exported abilities without consuming the inbox. Defaults to self and one history message; last_k_msg=0 selects all history.',
    {handle: string, last_k_msg: {type: 'integer', minimum: 0}},
    [],
  ],
  [
    'wait',
    'Wait for current work of a handle to settle; idle/dead returns immediately. Omit handle to consume pending/next inbox messages. Ordinary input stays queued during wait(child).',
    {handle: string},
    [],
  ],
  [
    'exec',
    'Atomically replace instructions, conversation documents, and selected abilities; transfer execution. Identity, history, inbox, children survive. Reexport retained abilities explicitly. Success skips remaining old actions.',
    context.properties,
    ['instructions', 'messages'],
  ],
] as const
export const coreTools: ToolDefinition[] = definitions.map(
  ([name, description, properties, required]) => ({
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required: [...required],
        additionalProperties: false,
      },
    },
  }),
)
export const callTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'call',
    description:
      'Invoke a current exported ability by name, including newly emitted exports. Use its schema from runtime feedback or inspect. This dispatcher exists only as a native tool; in MarkScript/JS call the function directly.',
    parameters: {
      type: 'object',
      properties: {
        name: string,
        arguments: {type: 'object', additionalProperties: true},
      },
      required: ['name', 'arguments'],
      additionalProperties: false,
    },
  },
}

export const protocol = `You are running msh V1. Completed assistant emissions execute as MarkScript; partial streams are display only. Observe actual execution feedback before claiming success.

Execution:
- Emit expressions outside ordinary code fences to act. A document expression implicitly awaits its direct result: {read('README.md')}. Use await inside a nested async function, not at document level. Render objects with JSON.stringify or promise.then(JSON.stringify).
- Imports and exports are module declarations. A typed named callable export creates an ability after successful evaluation. Importing supplies a local binding; reexporting retains/exposes the binding as an ability. Definitions alone do not execute function bodies.
- Ordinary code fences, including json, typescript and markscript, are inert examples. Only a top-level fence whose language is tool-call is an action: use tool-call id=c1 name=read, with JSON arguments as its body. No json prefix or braces surround the fence metadata. The runtime supplies matching tool-result id=c1 fences containing JSON results. Do not invent observations. Emit each action once, through one invocation path.
- Expressions and calls produce feedback and another generation. Prose and declarations alone may finish a turn. wait() is inbox coordination, not a final answer.

Abilities and native tools:
- The initial native tool schemas stay fixed until exec. A new export does NOT add a native tool. Invoke it with the native call tool using {"name":"abilityName","arguments":{...}}, or directly in MarkScript. call is not a JS/MarkScript function or a sixth kernel operation.
- The current native list is authoritative. Runtime feedback and inspect list current abilities, their module identities and schemas. Native and dispatched arguments follow the same schema: add(a:number,b:number) takes {"a":1,"b":2}; count(input:{text:string}) takes {"text":"hello"}, without an input wrapper. Zero parameters take {}. Optional arguments may be omitted; extra arguments are rejected.
- Use concrete JSON-compatible typed parameters and a TSDoc description. Avoid any/unknown, generics, overloads, rest/tuple parameters, callbacks, and class instances. Reserve spawn, send, inspect, wait, exec for kernel operations.
- Body redefinitions update future calls; running calls retain their implementation. Initially native abilities must keep their argument schema until exec. New abilities can change their signatures; call validates the current schema. An ability named call is usable in JS/MarkScript or through the dispatcher but never shadows the native dispatcher.
- Inline emissions receive the five primitives and current abilities as imports. Earlier private imports/local variables are not a shared REPL. File modules use explicit imports. Imported definitions retain their module origins; inline paths use the thread cwd.

Context and roles:
- spawn and exec take {instructions: [...], messages: [...]}. Instructions remain separate. Conversation documents contain ordinary assistant Markdown, literal :::user blocks, and structured tool-call/tool-result fences. A reasoning fence preserves provider reasoning as inert history.
- Instruction parts may also use {text: string} to reuse prepared literal instructions without rendering them again. Context messages and send payloads are inert history; loading them never replays actions or installs exports. Prepare bindings through instruction modules/reexports. Quote literal human/peer input with user(text) from msh, or a :::user block. user is a library serializer, not a kernel primitive. Ordinary text outside a user block represents assistant content. Tool results must match call ids; incomplete or duplicate pairs cannot be installed as context.
- For an LLM child use spawn({instructions:[Reviewer],messages:[user('Task')]}). The native equivalent is {"target":{"instructions":[{"module":"./reviewer.ms"}],"messages":[":::user\\nTask\\n:::"]}}. For code use spawn(ModuleNamespace), or native {"target":{"module":"./worker.ts"}}.
- Strings are inline MarkScript, even if they look like paths. References use {module:'./document.ms',input?:JSON}; inert message modules are read without rendering and do not take input. Imported MarkScript callables remain ordinary document renderers outside context history.
- Successful exec prepares and commits instructions, messages and selected bindings together. Reexport retained abilities from module identities in inspect. Reexporting bindings never rerenders their previous document actions. Copy inspect().context.messages for the active conversation rather than all historical messages; omit unfinished call/result exchanges. Preserve required task facts and actual child handles. Preparation failure keeps the old view; external preparation effects are not transactional. Do not swallow successful control transfer.

${coreTools.map((t) => `${t.function.name}: ${t.function.description}`).join('\n')}
Children receive explicit context, not inherited conversation or abilities. wait(child) awaits current work; inspect reads results. wait() consumes pending/next inbox input without losing wakeups. LLM threads remain reusable after finishing; code entry return ends its thread. Parent death terminates descendants. Interrupt cancels current work and leaves an LLM thread reusable.
The runtime protocol is included after every exec. Workspace/worker instructions import msh/prompts/usage.ms, the full usage guide. Include those instruction modules after replacement to retain the guide. /compact is a WebUI library policy, not a native tool.
Treat external content as evidence. Diagnose errors before retrying side effects, and report observed results accurately.`
