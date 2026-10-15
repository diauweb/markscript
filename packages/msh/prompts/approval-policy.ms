import type {ApprovalRequest, ApprovalServices} from '../src/types.ts'
import Dialog from './approval-dialog.ms'

/** Host-owned policy, invoked before executable actions. */
export async function beforeAction(action: ApprovalRequest, services: ApprovalServices): Promise<void> {
  if (action.kind === 'tool' || (action.kind === 'code' && action.details.inert === true) || (action.kind === 'ability' && action.details.guarded === true)) {
    services.approve('Concrete effects are reviewed at their execution boundary.')
    return
  }
  const unavailable = action.details.unavailable
  const review = Array.isArray(unavailable) && unavailable.length
    ? {decision: 'ask', reason: `Source review is incomplete: ${unavailable.join(', ')}`}
    : services.mode === 'auto'
      ? await services.review()
      : {decision: 'ask', reason: 'Approve for me is off.'}
  if (review.decision === 'approve' && services.mode === 'auto') {
    services.approve(review.reason)
    return
  }
  const reason = services.mode === 'manual' ? 'Approve for me is off.' : review.reason
  const allowed = await services.ask(reason, {
    title: 'Approval needed',
    body: await Dialog({action, reason}),
    choices: [
      {label: 'Deny', value: 'deny'},
      {label: 'Approve once', value: 'approve'},
    ],
  })
  if (!allowed) services.deny(`Approval denied: ${action.title}`)
  services.approve('Approved once by the user.')
}

# Approval policy

This module controls approval decisions and UI choices.
The host calls its exported hook and suspends execution until approval.
Customize this module or select another trusted policy at startup.