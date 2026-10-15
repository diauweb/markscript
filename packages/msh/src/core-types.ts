import type {Root} from 'mdast'
import type {Extension, ExtensionScope} from './extensions.ts'

export type Handle = string
export type State =
  | 'initializing'
  | 'running'
  | 'waiting'
  | 'idle'
  | 'stopping'
  | 'dead'
export interface ModulePart {
  module: string
  input?: unknown
}
export type DocumentEntry = (...args: never[]) => Promise<Root>
export type ContextPart = string | ModulePart | DocumentEntry
export type InstructionPart = ContextPart | {text: string}
export interface ThreadContext {
  instructions: InstructionPart[]
  messages: ContextPart[]
}
export type CodeModule = {default: () => unknown | Promise<unknown>}
export type Target = ThreadContext | ModulePart | CodeModule
export type Recipient = Handle | Handle[] | 'descendants'
export type Delivery =
  | string
  | ContextPart[]
  | {control: 'interrupt' | 'terminate'}
export interface ContextRecord {
  module: string
  text: string
  rendered?: Root
  input?: unknown
}
export interface Binding {
  name: string
  module: string
  value: unknown
}
export interface Prepared {
  records: ContextRecord[]
  bindings: Map<string, Binding>
  acted: boolean
}
export interface RuntimeEvent {
  seq: number
  time: string
  thread: Handle
  invocation?: string
  span?: string
  parentSpan?: string
  type: string
  data: unknown
}
export interface Operation {
  kind: string
  title: string
  details: Record<string, unknown>
}
export interface ActionInvocation extends Operation {
  thread: Handle
  cwd: string
  signal: AbortSignal
}
export interface Options {
  cwd?: string
  context?: ThreadContext
  extensions?: Extension[]
  onEvent?: (event: RuntimeEvent) => void
}
export interface Snapshot {
  id: Handle
  parent?: Handle
  kind: 'context' | 'code'
  state: State
  cwd: string
  generation: number
  pending: number
  children: Handle[]
  context: {instructions: ContextRecord[]; messages: ContextRecord[]}
  modules: ContextRecord[]
  bindings: {name: string; module: string}[]
  extensions: {name: string; module: string}[]
  history: ContextRecord[]
  error?: string
  result?: unknown
}
export interface WaitResult {
  reason: 'settled' | 'message'
  thread: Handle
  state: State
  messages: ContextRecord[]
}
export interface ContextPreparation {
  thread: Handle
  context: ThreadContext
  prepared: Prepared
  messages: ContextRecord[]
  replacing: boolean
  scope: ExtensionScope
}
export interface Evaluation {
  module: string
  source: string
  input?: unknown
  resolve(specifier: string, cwd: string): string
}
