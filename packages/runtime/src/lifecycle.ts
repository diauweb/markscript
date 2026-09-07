import {AsyncLocalStorage} from 'node:async_hooks'
import {runtimeError} from './errors.ts'
import {deepFreeze} from './freeze.ts'
import {lowerToRoot} from './lower.ts'
import {resolveComponents} from './resolve-components.ts'
import type {
  DocumentRenderer,
  ReadyCallback,
  ReadyContext,
  TransformCallback,
  TransformContext,
} from './types.ts'
import {validateRoot} from './validate.ts'

type DocumentPhase = 'render' | 'transform' | 'ready' | 'closed'

interface DocumentState {
  phase: DocumentPhase
  readonly transforms: TransformCallback[]
  readonly readyCallbacks: ReadyCallback[]
}

const documentState = new AsyncLocalStorage<DocumentState>()

/** Register mutable work for the complete baseline MDAST. */
export function onTransform(callback: TransformCallback): void {
  if (typeof callback !== 'function') {
    runtimeError('ERR1301', 'onTransform(callback) requires a function')
  }
  const state = requireRenderState('onTransform')
  state.transforms.push(callback)
}

/** Register ready-lifetime work against the validated frozen MDAST. */
export function onReady(callback: ReadyCallback): void {
  if (typeof callback !== 'function') {
    runtimeError('ERR1301', 'onReady(callback) requires a function')
  }
  const state = requireRenderState('onReady')
  state.readyCallbacks.push(callback)
}

/** Execute one isolated document render and its complete lifetime. */
export async function executeDocument(render: DocumentRenderer) {
  if (typeof render !== 'function') {
    runtimeError('ERR1301', 'executeDocument(render) requires a function')
  }

  const state: DocumentState = {
    phase: 'render',
    transforms: [],
    readyCallbacks: [],
  }

  return documentState.run(state, async () => {
    try {
      const value = await resolveComponents(await render())
      const root = lowerToRoot(value)

      state.phase = 'transform'
      const transformContext: TransformContext = Object.freeze({root})
      for (const callback of state.transforms) {
        await callback(transformContext)
      }

      validateRoot(root)
      try {
        deepFreeze(root)
      } catch (error) {
        runtimeError(
          'ERR1201',
          'the final MDAST must contain only deeply-freezable plain objects, arrays, and scalar values',
          {cause: error},
        )
      }

      state.phase = 'ready'
      const readyContext: ReadyContext = Object.freeze({root})
      for (const callback of state.readyCallbacks) {
        await callback(readyContext)
      }

      return root
    } finally {
      state.phase = 'closed'
      state.transforms.length = 0
      state.readyCallbacks.length = 0
    }
  })
}

function requireRenderState(api: 'onTransform' | 'onReady'): DocumentState {
  const state = documentState.getStore()
  if (state === undefined) {
    runtimeError(
      'ERR1301',
      `${api}(callback) can only be called while a MarkScript document is rendering`,
    )
  }
  if (state.phase !== 'render') {
    runtimeError(
      'ERR1301',
      `${api}(callback) is available only during rendering; current phase: ${state.phase}`,
    )
  }
  return state
}
