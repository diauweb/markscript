# msh V1

msh runs persistent threads with MarkScript instructions, conversation documents, and executable model emissions.
Typed exports become abilities. JS/TS modules give code threads through a default entry.
The runtime has five operations. The imported agent's native LLM interface also has an adapter-only `call` dispatcher.

## Core and imported extensions

`msh/core` gives generic execution contexts, standard exported bindings, mailboxes, suspension, context replacement, and scope-owned registrations.
`createHarness()` starts a reusable context.
The `agent` extension gives model turns, conversation roles, JSON tool schemas, native dispatch, and prompt policy.
The `approval` extension gives review.
`createShell()` combines both extensions for the CLI, WebUI, and embedded applications.

An import of a module with a `defineExtension` descriptor activates that extension in the current context.
ESM loading uses a cache. Setup executes separately for each context installation.
Relative dependency imports and reexports also activate their descriptors.
Repeated imports in one generation reuse the installation. Imported descriptor setup executes before document rendering.

```ts
// feature.ts
import {defineExtension} from 'msh/core'

export const feature = defineExtension('workspace.events', scope => {
  scope.on('document', event => console.error(event.data))
  return () => console.error('Context disposed')
})
```

```markscript
import './feature.ts'

export function count(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}
```

A scope gives `hook`, `on`, `provide`/`get`, `run`, and `cleanup`. Hooks resolve in registration order.
Events give observations. Listener errors do not stop execution.
Runners start after installation commits and receive an execution context with a cancellation signal.

Replacement and termination remove registrations, cancel owned work, and wait for cleanup.
Failed setup removes staged registrations and keeps the earlier context active.
Cleanup failures make `cleanup.error` records while other resources close.

Core hooks are `evaluate.before`, `evaluate.ready`, `action.before`, `context.before`, `context.prepare`, `context.append`, `messages.before`, `messages.commit`, and `input`.
Context preparation hooks can use the draft scope's `onCommit` to publish prepared extension state.
The `input` hook gives an execution driver that the runtime waits for.
Host-installed extensions apply across threads and survive context replacement.
Context-installed extensions use their context generation.

`evaluate.before` precedes module loading.
`evaluate.ready` follows imported extension activation and precedes document rendering or code entry.
The agent validates JSON tool signatures at these boundaries.
An agent import during a turn transfers the driver and keeps the conversation and exported abilities.
The first agent in a populated generic context adopts instructions, message records, and callable exports as its initial model interface.

A module can also give the model driver. The bundled deterministic example creates its provider during each activation:

```ts
import {createHarness} from 'msh/core'

const host = await createHarness({
  context: {
    instructions: [{module: 'msh/examples/pluggable.ms'}],
    messages: [],
  },
})
try {
  await host.send(host.root, ':::user\nCalculate 20 + 22.\n:::')
  await host.wait(host.root)
  console.log(host.inspect().bindings)
} finally {
  await host.close()
}
```

`msh/agent` exports `agent(options)`, `Agent`, and a current-context inspector.
`agent(scope => options)` creates independent provider configuration per activation.
Core inspection gives bindings, document records, extension origins, and lifecycle state.
Agent inspection gives conversation records, ability schemas, and native tools.
Compaction keeps imported extension origins and selected ability bindings.

## Run

```sh
bun run build
bun run msh demo
bun run msh demo --web
bun run msh login local --base-url http://localhost:8080/v1 --model MODEL --no-auth
bun run msh chat
bun run msh chat --prompt 'Review the parser'
bun run msh chat packages/msh/examples/arithmetic.ms --prompt 'Add 20 and 22'
```

The deterministic demo runs without credentials. It defines an ability and calls it through native `call`.
API-key profiles support `--api-key-env NAME` or `--key-stdin`. Interactive login masks the key.
`msh models`, `msh profiles`, and `msh profiles use NAME` manage endpoints.
Credentials stay in private storage.

The local WebUI uses React, TypeScript, and Kumo UI.
Run `msh chat` in a terminal, or select the WebUI explicitly with `msh chat --web`.
Open the full URL from stderr in a browser.
The server binds to `127.0.0.1` and selects an available port.
`--port 3000` selects a fixed port.

The session fragment authenticates browser controls. Provider credentials stay in the local process.

The conversation and multiline composer stay together.
The interface has a thread list and optional context, ability, event-history, or help inspector.
Commands give creation, compaction, provider and model changes, saved conversations, approval mode, termination, and export.
A Kumo dialog has a filter and keyboard and mouse selection.
Compact windows use side panels over the main area.

| Key | Action |
|---|---|
| Enter | Send the composer message |
| Ctrl+J or Shift+Enter | Insert a newline |
| Tab / Shift+Tab | Move between controls |
| Ctrl+B | Show or hide threads |
| Ctrl+K | Open or close commands |
| F1 | Open or close help |
| Up/Down, Enter | Navigate threads, conversation details, or command choices |
| Space | Show or hide focused details |
| Left / Right | Collapse or expand focused details |
| PageUp / PageDown | Scroll the focused pane |
| Escape | Close the active dialog or inspector |
| Ctrl+C | Stop the selected turn. Copy selected browser text |
| Ctrl+D | Close the session with an empty composer |

Send becomes Queue during an active turn. Stop keeps an LLM thread available for another message.
Terminate ends its subtree. State labels, activity indicators, and elapsed time show active work.

Approval dialogs use the policy's rendered document and choice labels. Deny has initial focus.
Close or Escape keeps the decision pending. Review opens it again.

Thread inputs have a static label and display as documents. Markup and static JSX format the body.
Module declarations and expressions display as code.
Runtime feedback has its own label with evaluated observations and exported abilities.
Original input and feedback stay in provider context and saved history.

Conversation cards show finalized MDAST from assistant execution.
Expressions, async components, directives, and transforms appear as rendered output.
Streaming shows source until evaluation completes. Message details keep that source.
Saved conversations, instructions, and approval bodies use the same renderer.

Reasoning, arguments, results, and metadata expand on request. Calls pair with results and show execution state.
`/tools` expands or collapses details. Thread references open the corresponding thread.
Drafts, scroll positions, and disclosure choices survive thread changes, including access to ended threads.

The context inspector separates instructions and active conversation.
The ability inspector shows fixed native tools and functions available through the dispatcher or direct calls.

Use `/new`, `/switch ID`, `/threads`, `/context`, `/abilities`, `/history`, `/tools`, `/sessions`, `/compact`, `/profile`, `/model`, `/export [FILE]`, `/terminate`, `/approve-for-me`, `/approvals`, `/help`, and `/quit`.
The export dialog writes a new file in the selected thread's cwd.
`.md` or `.ms` selects its conversation. Other extensions select the full JSONL run.

Browser closure permits reconnection to the active local process.
Quit or terminal Ctrl+C closes the session and cleans up work.

`bun run build` builds the browser bundle.
For frontend development, use `bun run --filter msh web:build`.
Run `bun run msh demo --web` to examine the built interface with the local runtime.

## Context and the five operations

```ts
import Reviewer from './reviewer.ms'
import * as CodeWorker from './worker.ts'
import {user} from 'msh'
import {spawn, send, inspect, wait, exec} from 'msh/kernel'

const reviewer = await spawn({
  instructions: [Reviewer],
  messages: [user('Review parser error handling.')],
})
await wait(reviewer)
const report = inspect(reviewer)
await send(reviewer, user('Now check source positions.'))
const worker = await spawn(CodeWorker)
await send(worker, user('One message for the code worker.'))
```

- `spawn({instructions, messages} | codeModule)` creates a child.
  Instructions are executable MarkScript strings, `{module, input?}` references, imported document functions, or prepared literal `{text}` records.
  Messages are inert source strings or `.ms` references and callables. The runtime reads them without import or rendering.
  Native spawn uses `{target: ...}`.
- `send(target, message)` queues conversation documents for one or more handles.
  Standard unwrapped text represents assistant content. Use `user(text)` to quote incoming text.
  `descendants` broadcasts below the caller. Reserved controls `{control:'interrupt'}` and `{control:'terminate'}` act immediately.
- `inspect(handle = 'self')` from `msh/kernel` shows core state.
  The agent inspector from `msh/agent` accepts `last_k_msg = 1`. Inspection consumes no messages. Zero selects all saved messages.
  `context` contains active instructions and conversation documents. `messages` contains historical records.
  `conversation` is the full readable transcript. `abilities` lists current definitions and origins.
  `nativeTools` lists fixed native schemas.
- `wait(handle)` waits for current work to settle. Idle or dead targets return immediately.
  `wait()` consumes pending or next inbox messages. Standard messages stay queued during child waits.
- `exec({instructions, messages})` prepares and atomically replaces active context and abilities. Then it transfers execution.
  Identity, history, inbox, and children survive. Failure keeps the earlier view.
  External preparation effects cannot be reversed. The runtime skips remaining old actions.

Native exec directly accepts `{instructions:[...], messages:[...]}`. It rebuilds the native interface from replacement instruction exports.
An LLM turn end leaves its thread idle. A code entry return ends its thread.
Parent termination ends descendants.

Cancellation terminates process groups that workspace commands own.
Other code cooperates through `useContext().signal`.

## Readable conversation documents

Instructions stay in `instructions`. In conversation documents, standard Markdown is assistant content.
A `:::user` block is literal user content.
`user(text)` selects a safe delimiter for nested fences and any text.

````markscript
:::user
Read the package manifest.
:::

I'll inspect it.

```tool-call id=c1 name=read
{"file":"package.json"}
```

```tool-result id=c1
"Observed manifest contents"
```

The manifest was read successfully.
````

The code-fence language is `tool-call` or `tool-result`. Its body uses JSON.
Calls must have `id` and `name`. Results must have the corresponding `id`. All protocol fences must close.
Native calls and explicit action fences normalize to the same records.

Conversation export and restoration keep provider reasoning in inert `reasoning` fences.

A new assistant tool-call fence executes in document order. The runtime gives live observations.
Context, delivery, and history documents stay inert. Loading them repeats no actions and installs no exports.
Replacement history must have full call/result pairs with unique IDs.

Standard code fences, including `json` and `markscript`, are examples.
Static MarkScript checks and compilation process source without execution.

## Fixed native tools and emitted abilities

```markscript
/** Count words. */
export function count(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}

{String(count('two words'))}
```

A directly emitted export installs an ability. The expression makes execution feedback.
New abilities keep native tool schemas unchanged.
Call `count('two words')` directly in MarkScript.
Alternatively, call native `call` with `{"name":"count","arguments":{"text":"two words"}}`.

`call` has no JS export or implicit binding.
The five kernel functions are standard functions available to JS/TS and MarkScript.

Initial instruction exports are native tools for that generation. Names, descriptions, schemas, and order stay fixed until exec.
A body-only redefinition updates later calls.
For a changed initially native argument schema, use a new name or exec.

Dynamic abilities can change signatures. `call` validates their current schema. Active calls keep their captured implementation.
An exported ability with the name call stays separate from the dispatcher.

TypeScript analysis derives concrete JSON input schemas and TSDoc descriptions.
A single object parameter is flattened. Scalar and array parameters use named fields.
An import gives a local binding. A reexport installs an ability.

Runtime feedback and inspection report current names, schemas, and immutable module identities.
Existing callable documents keep their standard MDAST ABI.

Module imports resolve relative to their defining module. Inline imports use cwd.
A string that looks like a path is still inline source. Use `{module:'./file.ms'}` for references.
The runtime reads message modules as source. They accept no render input.

## Replacement, compaction and the LLM guide

```markscript
import {user} from 'msh'

{exec({
  instructions: [
    {module: 'msh/prompts/worker.ms'},
    'export {count} from "/absolute/identity/from-inspect.ms"'
  ],
  messages: [user('Continue counting the supplied text.')]
})}
```

Reexports reuse loaded definitions without repeated document body actions. Omitted abilities disappear.
To keep prepared instruction bytes, pass `state.context.instructions.map(({text}) => ({text}))` with selected reexports.
`state.context.messages` contains active conversation documents.
Copy only full exchanges. Exclude an unfinished exec call.

`/compact` creates a separate summarizer thread.
It keeps prepared instructions and explicit bindings, then installs a quoted summary through exec.
full history stays available. Concurrent parent changes invalidate the prepared summary.

Workspace and worker instructions import [`prompts/usage.ms`](prompts/usage.ms), the shared model guide.
It covers exposure, dispatch, schemas, executable syntax, conversation fences, child context, waits, redefinition, replacement, and recovery.
Scripted-provider tests execute its examples.
The runtime protocol is present on each request, including after exec.

## Approve for me and policy hooks

**Approve for me is on by default.**

Before general code, commands, or file edits execute, a separate model request reviews the concrete action against the user's request.
Destructive effects must have clear authorization for their targets.
Uncertainty, incomplete source evidence, or reviewer failure opens an approval dialog.
Built-in file reads, lists, and searches proceed directly.

The dialog shows the proposed action, reason, and user requests.
Use Up/Down and Enter, or click **Approve once** or **Deny**. Deny is initially selected.
Tab moves between choices and scrollable details.

Escape keeps the action paused during workspace inspection. `/approvals` opens it again. Ctrl+C cancels the pending action.
During a turn, denial stops work and keeps the LLM thread available for new input.
Denial during initial preparation closes the local session with an error.

`/approve-for-me` changes automatic review mode in the palette or composer.
`msh chat --no-approve-for-me` starts with it off. This mode uses manual approval for code, commands, and edits.
A noninteractive run returns an approval-required error for a necessary human decision.
The demo uses a scripted reviewer for its fixed actions and runs without credentials.

The mechanism calls `beforeAction` before native tool dispatch and executable actions.
[`prompts/approval-policy.ms`](prompts/approval-policy.ms) contains default policy.
[`prompts/approve.ms`](prompts/approve.ms) contains the reviewer prompt.
[`prompts/approval-dialog.ms`](prompts/approval-dialog.ms) contains the UI document.
Select a trusted custom policy at startup:

```sh
bun run msh chat --approval-policy ./approval.ms
```

A policy exports the hook and gives the UI as a rendered MarkScript document:

```ts
import type {ApprovalRequest, ApprovalServices} from 'msh'
import Dialog from './approval-dialog.ms'

export async function beforeAction(action: ApprovalRequest, services: ApprovalServices) {
  if (action.kind === 'tool' ||
      (action.kind === 'code' && action.details.inert === true) ||
      (action.kind === 'ability' && action.details.guarded === true)) {
    services.approve('Review concrete effects at the action boundary.')
    return
  }
  const accepted = await services.ask('Review this action.', {
    title: 'Workspace approval',
    body: await Dialog({action, reason: 'Review this action.'}),
    choices: [
      {label: 'Deny', value: 'deny'},
      {label: 'Approve once', value: 'approve'},
    ],
  })
  if (!accepted) services.deny('Declined by the user.')
  services.approve('Approved once by the user.')
}
```

Copy the bundled dialog as an initial version.
`services.review()` requests an isolated review and returns `{decision: 'approve' | 'ask', reason}`.
The policy decides when to review or ask. The host suspends execution and gives the human decision.
A hook must explicitly approve to continue.

The user selects policies independently of model-emitted abilities. Policies execute with host trust.

Embedded applications can also reject actions through `createShell({beforeAction: async action => { ... }})`.
An action includes kind, title, details, thread, working directory, and cancellation signal.
Custom interfaces connect with `host.approvals.connect()` and observe `approval.pending`.
They answer with `host.approvals.decide(id, 'approve' | 'deny')`.
Call the returned disconnect function during cleanup.

`host.approvals.setMode('auto' | 'manual')` controls automatic review. These APIs add no native tool or kernel operation.
For approval during initial preparation, construct `new Shell(options)`.
Connect the interface. Then call `await host.initialize()`. `createShell(options)` initializes immediately.

After approval, the host rechecks the source graph and existing file content. If evidence changes, make another attempt.
Events record decisions and cancellations. Approval gives an execution review workflow.
Code executes with trusted Bun authority. Isolation of hostile code must use an OS boundary.

## Embedding and saved history

```ts
import {createShell, defaultContext, chatCompletions} from 'msh'

const host = await createShell({
  cwd: process.cwd(),
  context: defaultContext(),
  provider: chatCompletions({baseURL: 'http://localhost:8080/v1', model: 'MODEL'}),
})
try {
  const result = await host.turn('Inspect this workspace.')
  console.log(result.conversation)
} finally {
  await host.close()
}
```

`host.turn` and the WebUI quote user input. Low-level `send` accepts conversation documents.
Events record lifecycle, prepared context, original emissions, normalized messages, native calls, and actual results.
`HistoryWriter` saves inert JSONL. `readHistory` and `historyDocument` examine or export it without source execution.
Existing saved files and profile settings stay available.

```sh
bun run msh sessions
bun run msh sessions show ID
bun run msh sessions export ID
bun run msh sessions export ID --markdown
bun run msh sessions export ID --markdown --thread HANDLE
```

JSONL exports contain the full run. Markdown exports default to the root conversation or selected thread.
In the WebUI, `/export history.ms` or `/export history.md` exports the selected conversation.
Other filenames export JSONL events. New processes start new live threads.
Set `MSH_HOME` to select separate profile and session storage.

## Tracing

Enable LangSmith tracing for a chat with these environment variables:

```sh
export LANGSMITH_TRACING=true
export LANGSMITH_API_KEY=YOUR_KEY
export LANGSMITH_PROJECT=msh
bun run msh chat --prompt 'Inspect this workspace.'
```

Each thread has a trace with child turns, model requests, tool calls, document evaluations, and ability calls.
Child threads attach to their parent execution.
Open a model request to examine full prompts and tools, assistant text, provider reasoning, calls, finish reason, and token usage.

Stream events keep text and timestamps. Tool and activity spans show inputs, outputs, duration, and failures.
Failed or interrupted requests keep partial text. A successful `exec` records a context transfer.

Traces include conversation and execution content: full prompts, tool arguments, and results.
Local JSONL history also contains these model-round records.
Thread IDs, turn invocation IDs, and unique execution IDs relate concurrent child events and repeated provider tool-call IDs.

Embedded applications attach the observer explicitly:

```ts
import {createShell, langsmith} from 'msh'

const observer = langsmith({enabled: true, project: 'workspace-agent'})
const host = await createShell({provider, ...(observer ? {observer} : {})})
try {
  await host.turn('Inspect this workspace.')
  await observer?.flush()
} finally {
  await host.close()
}
```

`langsmith` accepts a configured LangSmith `Client` through `client`.
`flush()` sends pending updates and keeps active spans.
`host.close()` waits for all work and cleanup records before the final flush.
It rejects if trace delivery fails. Trace transport failures stay isolated from agent execution.

Model spans use LangSmith's [LLM trace format](https://docs.langchain.com/langsmith/log-llm-trace).
This format gives message rendering, token counts, and time to first token.

The fixed native interface keeps request prefixes eligible for cache reuse between execs. Cache hits depend on the endpoint.
Scripted and local HTTP checks verify request structure and semantics.
Actual model comprehension and cache hit rates are subjects for provider evaluation.