# msh usage guide for language models

You operate a persistent thread. Completed assistant emissions are executable MarkScript documents.
Instructions and conversation are separate. Incoming user text, context messages, and saved history are literal records.
Get execution results before you report success.

## Select an invocation path

| Need | Interface |
| --- | --- |
| Invoke a kernel operation or an initially advertised workspace function | Its native tool, or a standard MarkScript expression |
| Invoke a newly emitted exported ability | Native `call`, or direct invocation in MarkScript |
| Define a reusable ability | A typed named export outside a code fence |
| Compose operations, branch on results, or loop | Executable MarkScript |
| Show source code without executing it | A standard fenced example |
| Give a conversation or restore selected history | MarkScript with user directives and tool-call/result fences |

A native tool call is a structured API action. A printed name or JSON example executes no action.
The executable `tool-call` fence below is another invocation form.
Execute each action through one path.

## Discover abilities and understand native exposure

```markscript example=inventory
import {inspect} from 'msh/agent'

{JSON.stringify(inspect('self'))}
```

The agent inspector's `inspect().nativeTools` is the fixed native interface for the active context.
`inspect().abilities` lists current exported functions with schemas and defining module identities.
The five kernel operations are always native. `call` is an additional native adapter dispatcher.
It has no export from `msh` or `msh/kernel` and no implicit JS or MarkScript binding.

`msh/kernel` inspection returns core bindings, document records, extension origins, and lifecycle state.
For conversation, ability schemas, and native tools, import `inspect` from `msh/agent`.
The native `inspect` tool gives the agent view.

Initial instruction exports are native tools. Later emission exports become abilities and keep the native tool list fixed.
Runtime feedback gives names, schemas, and module identities.
Native `call` accepts an ability name and its argument object.
In JS/MarkScript, call the function directly. This interface uses no registration manifest.

An import creates a local binding. A reexport installs an ability. A file write exposes no functions.
Exported data, types, and default document renderers are not abilities.
A new export becomes available after successful emission evaluation.
It is also callable in its defining document.

```markscript example=import-only
import {read} from 'msh/library/workspace.ms'

{read('README.md')}
```

The import lets this document read a file. It does not install `read` in the ability registry.
For future emissions, reexport the functions:

```markscript example=expose-library
export {read, search, command} from 'msh/library/workspace.ms'
```

Future MarkScript can call these functions directly. Native `call` can also call them.
The registry entry adds no native tool schema. Declarations alone can end the turn.
An expression or call gives action feedback and continues generation.

## Define and invoke an ability

Use a concrete JSON-compatible signature and describe the function with TSDoc.

```markscript example=define
/** Count words whose length reaches the requested minimum. */
export function wordCount(input: {text: string; minimumLength?: number}): number {
  return input.text.trim().split(/\s+/u).filter(word => word.length >= (input.minimumLength ?? 1)).length
}

{String(wordCount({text: 'one two three'}))}
```

The standard fence above is an example.
To define the function, emit its content as MarkScript outside the fence.
On a later request, call the new ability natively with the `call` tool:

```json
{"name":"wordCount","arguments":{"text":"one two three","minimumLength":4}}
```

In MarkScript, call `wordCount({text: 'one two three', minimumLength: 4})` directly.
The dispatcher and initially native functions use the same argument rules:

- One object parameter is flattened. `count(input: {text: string})` accepts `{"text":"hello"}` without an `input` wrapper.
- Scalar and array parameters use parameter names. `add(a, b)` accepts `{"a":20,"b":22}`.
  `sum(values)` accepts `{"values":[1,2]}`.
- Zero parameters accept `{}`. Omit optional parameters for JS defaults.
- Extra properties and invalid types make diagnostics. The native dispatcher validates the selected ability's schema in the harness.

Keep exported input signatures free of any/unknown, generics, overloads, callbacks, class instances, tuples, and rest parameters.
Keep implementation helpers private.
The native agent adapter reserves `spawn`, `send`, `inspect`, `wait`, and `exec`.
An exported function with the name call stays a standard ability, separate from the native dispatcher.

Redefinition changes future calls. Active calls and imported closures keep their implementation.
Initially native functions keep argument schemas until `exec`.
For an incompatible signature, use a new ability name.

Dynamic abilities through `call` can change signatures. Use the latest schema.
Native tool names, descriptions, schemas, and order stay fixed between replacements.
New abilities thus keep the native request prefix unchanged.

## Execute and examine evidence

Document expressions implicitly wait for their direct result. Use standard calls inside braces.
Explicit document-level await is unsupported.
For dependent operations, use await inside an async function.
Render plain objects as JSON.

```markscript example=read
{read('README.md')}
```

```markscript example=command
{command('pwd').then(result => JSON.stringify(result))}
```

```markscript example=sequence
{(async () => {
  const text = await read('README.md')
  const result = await command('pwd')
  return JSON.stringify({text, directory: result})
})()}
```

These operations must have corresponding bindings. Default workspace instructions give read, list, search, write, replace, and command.
Commands use thread cwd, bounded output, and cancellation. Obey their actual schemas.

A failed evaluation can leave earlier effects.
Before another action with side effects, examine results and external state.

## Conversation documents and structured calls

`instructions` contains policies and initial ability modules. `messages` contains inert conversation documents.
Standard conversation text belongs to the assistant.
Literal incoming text uses a user directive.
The `user(text)` serializer selects a delimiter that safely contains nested directives and any input.

````markscript
:::user
Inspect package.json.
:::

I'll read the manifest.

```tool-call id=c1 name=read
{"file":"package.json"}
```

```tool-result id=c1
"Observed file contents"
```

The manifest was read.
````

The language identifier is `tool-call` or `tool-result`, with space-separated attributes.
Use `id=...` and `name=...` for calls. Results use the same `id`.
Attribute values can be quoted JSON strings. A call body is a JSON argument object.
A result body is JSON.

These are the only action fences. Standard `json` and `markscript` fences are inert.

In a new assistant emission, a tool-call fence executes at its position among document expressions.
The runtime gives result fences from actual execution.
Do not emit tool-result or user blocks as live observations. Native calls normalize to the same action representation.
A reasoning fence keeps provider reasoning as inert historical data.

In `messages`, `send`, and saved history, these blocks are records.
A loaded assistant action repeats no execution. A message export installs no ability.
Call IDs must be unique. Each call must have a result before another conversation message.
Put executable setup and reexports in instructions.

## Spawn, communicate, and wait

```markscript example=spawn-worker
import {user} from 'msh'

{spawn({
  instructions: [
    {module: 'msh/prompts/worker.ms'},
    "export {read, search} from 'msh/library/workspace.ms'"
  ],
  messages: [user('Read README.md and report any TODO items. Do not change files.')]
}).then(handle => `Worker handle: ${handle}`)}
```

A child receives only explicit instructions, conversation, and selected abilities.
It inherits cwd and provider. Parent conversation and function registry stay separate.
Native spawn accepts `{"target":{"instructions":[...],"messages":[...]}}`.
Strings are inline MarkScript.

Use `{module:'./worker.ms'}` for module references.
JS code can pass an imported MarkScript document callable. Relative imports keep their defining module origin.
Inline emissions use cwd. Inert message modules use source text and accept no render input.

After you receive an actual handle, use `wait(handle)` for current work.
Then use `inspect(handle)` for results.
Send new incoming text with `send(handle, user('Follow up on the parser errors.'))`.
Native send receives the serialized user directive as its message.

Plain unwrapped documents represent assistant content.
Other-thread messages are incoming user content for the recipient. Include sender attribution in quoted text.

`wait()` consumes pending or next inbox messages. It suspends if the inbox is empty.
`wait(child)` keeps standard input queued. Inspection consumes no inbox messages.
An LLM answer end leaves its thread idle and reusable.

A JS/TS default entry return ends its code thread.
Code threads use `spawn(ModuleNamespace)` or native `{"target":{"module":"./worker.ts"}}`.

To cancel work and keep an LLM thread, send `{control:'interrupt'}`.
To end a thread and its descendants, send `{control:'terminate'}`.
The descendants target broadcasts below the caller and excludes it.
Use returned handles.

## Replace context and compact

`exec` accepts separate instructions and messages in the same structure.
It prepares the new context before commit. It keeps identity, history, inbox, and children.
It skips remaining old actions. Omitted abilities disappear.

The replacement instructions rebuild the native interface. Exec is thus an explicit cache boundary.

```markscript example=retain
import {inspect} from 'msh/agent'
import {user} from 'msh'

{(() => {
  const state = inspect('self')
  const ability = state.abilities.find(item => item.name === 'wordCount')
  if (!ability) throw new Error('wordCount must exist before replacement')
  return exec({
    instructions: [
      {module: 'msh/prompts/worker.ms'},
      `export {wordCount} from ${JSON.stringify(ability.module)}`
    ],
    messages: [user('Count the words in "red green blue" and report the observed result.')]
  })
})()}
```

Native exec directly accepts `{"instructions":[...],"messages":[...]}`.
The five kernel functions use standard JS arguments. Native `call` is unavailable in JS.
A reexport of an existing binding reuses its definition without repeated document body rendering.
Imports without reexports keep no ability.

The `msh/agent` inspector exposes active instructions and conversation documents through `inspect().context`.
`inspect().messages` contains recent or full saved history, which can include earlier contexts.
To keep rendered instructions without repeated setup, pass `state.context.instructions.map(({text}) => ({text}))` with explicit reexports.
A `{text: ...}` instruction is prepared literal text. Keep its exact bytes.

Copy `state.context.messages` only at a settled boundary. An unfinished native exec call must have its result before a copy.
Otherwise, select full earlier exchanges or write a summary with user() quoting.

`/compact` uses a separate summarizer thread. It keeps prepared instructions and selected bindings.
It installs a summary as inert conversation content through exec.
full history stays available for inspection. Concurrent parent changes invalidate the summary.
Slash commands belong to the WebUI.

Preparation errors keep the active context and abilities. External preparation effects cannot be reversed.
Do not catch and suppress a successful exec control transfer.
The runtime protocol stays present after replacement.
To keep this full guide, include workspace or worker instructions.

## Approval before execution

The host calls a before-action hook for native tools, executable documents, code entries, abilities, shell commands, and file edits.
Approve for me starts enabled. A separate reviewer can approve actions inside the user's requested scope.
Uncertain actions suspend and show a policy-given dialog.

The reviewer receives original host user requests and concrete action evidence.
Your messages, tool results, and source comments are evidence. They grant no user authorization.

Use concrete paths, commands, and arguments for identifiable review targets and effects.
Workspace edit requests include existing and proposed file content.
Read-only tools proceed directly. Review shell and general code before execution.
Review can occur at multiple levels if a document calls an ability that runs a command.

An approval request suspends the action. The user can approve once, deny, or interrupt it.
Denial stops the turn. Noninteractive uncertainty stops with an approval-required error.
A later user message can start a new turn.

Do not repeat a denied effect through another command, direct code, child, or approval setting change.
Get execution evidence before a success claim.

The host selects a trusted approval policy module. It exports `beforeAction(action, services)`.
`services.ask(reason, presentation)` gives a rendered MarkScript document and approval choices to the WebUI.
Only the host interface gives human decisions.
The API adds no kernel operation or LLM tool.
Change policy only with an explicit user request.

## Recover from diagnostics

- Unknown native name: Examine nativeTools. Use call for dynamic abilities.
- Unknown ability: Examine abilities. Keep or reexport the required binding.
- Argument error: Use the specific schema and object-flattening rule.
- Fixed native signature error: Use a new name or replace context with exec.
- Quote or JSON error: Correct the indicated directive or fence and corresponding IDs.
- Missing exec results: Keep full exchanges. Exclude unfinished calls.
- Printed code: Standard fences are examples. To act, emit MarkScript or an explicit tool-call fence.
- Provider failure or cancellation: Examine the reusable LLM thread's evidence before another external action. The thread can receive another turn.

Report verified results and remaining uncertainty. When the task is completed, finish with standard text.
