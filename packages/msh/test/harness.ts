import {createShell as create} from '../src/shell.ts'
import type {ShellOptions} from '../src/types.ts'

/** Semantic fixtures authorize their own bounded actions; approval tests use the real default. */
export function createHarness(options: ShellOptions = {}) {
  return create({
    ...options,
    approval: options.approval ?? {
      reviewer: async () => ({
        decision: 'approve',
        reason: 'Authorized test fixture action.',
      }),
    },
  })
}
