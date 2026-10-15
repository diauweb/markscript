import type {ApprovalRequest} from '../src/types.ts'

export interface Input {
  action: ApprovalRequest
  reason: string
}

# {input.action.title}

{input.reason}

Thread: {input.action.thread}

Working directory: {input.action.cwd}

## Proposed action

<pre><code>{JSON.stringify(input.action.details, null, 2)}</code></pre>

## User request

<pre><code>{input.action.userRequests.join('\n\n') || 'No direct user request was supplied.'}</code></pre>

Approval applies once to this action. Denial stops the current turn.
Ctrl+C cancels the pending action.
Escape keeps it pending while you examine the thread.