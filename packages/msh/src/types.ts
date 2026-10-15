import type {Schema} from 'effect'
import type {Root} from 'mdast'
export type Json = Schema.Json
export type JsonObject = {[key: string]: Json}

import type {ContextRecord, Handle, ThreadContext} from './core-types.ts'

export type {
  CodeModule,
  ContextPart,
  ContextRecord,
  Delivery,
  DocumentEntry,
  Handle,
  InstructionPart,
  ModulePart,
  Recipient,
  RuntimeEvent,
  Target,
  ThreadContext,
} from './core-types.ts'
export type State = import('./core-types.ts').State | 'reviewing' | 'approval'
export interface ToolCall {
  id: string
  type: 'function'
  function: {name: string; arguments: string}
}
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  reasoning_content?: string
}
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}
export interface Completion {
  message: Message
  finishReason: string
  usage?: {prompt_tokens?: number; completion_tokens?: number}
}
export interface ModelRequest {
  messages: Message[]
  tools: ToolDefinition[]
  purpose: 'turn' | 'compaction' | 'approval'
  maxOutputTokens?: number
}
export interface Provider {
  identity?: {provider?: string; model: string}
  complete(
    request: ModelRequest,
    signal: AbortSignal,
    emit: (text: string) => void,
  ): Promise<Completion>
}
export interface HistoryMessage extends Message {
  id: number
  time: string
  document: string
  kind?: 'runtime'
  rendered?: Root
  renderError?: string
}
export interface AgentSnapshot {
  extensions: import('./core-types.ts').Snapshot['extensions']
  id: Handle
  provider?: {provider?: string; model: string}
  parent?: Handle
  kind: 'llm' | 'context' | 'code'
  state: State
  cwd: string
  generation: number
  pending: number
  children: Handle[]
  messages: HistoryMessage[]
  context: {instructions: ContextRecord[]; messages: string[]}
  modules: ContextRecord[]
  conversation: string
  nativeTools: ToolDefinition[]
  abilities: {name: string; module: string; definition: ToolDefinition}[]
  error?: string
  result?: unknown
  approvals: ApprovalRequest[]
}
export type ApprovalMode = 'auto' | 'manual'
export interface ApprovalAction {
  kind: 'tool' | 'code' | 'ability' | 'command' | 'write' | 'replace'
  title: string
  details: Record<string, unknown>
}
export interface ApprovalRequest extends ApprovalAction {
  id: string
  thread: Handle
  cwd: string
  time: string
  status: 'reviewing' | 'pending'
  reason: string
  userRequests: string[]
  presentation?: ApprovalPresentation
}
export interface ApprovalPresentation {
  title: string
  body: Root
  choices: {label: string; value: 'approve' | 'deny'}[]
}
export interface ApprovalServices {
  readonly mode: ApprovalMode
  review(): Promise<ApprovalReview>
  approve(reason: string): void
  deny(reason: string): never
  ask(reason: string, presentation: ApprovalPresentation): Promise<boolean>
}
export interface ActionInvocation extends ApprovalAction {
  thread: Handle
  cwd: string
  signal: AbortSignal
}
export interface ApprovalReview {
  decision: 'approve' | 'ask'
  reason: string
}
export interface ApprovalOptions {
  mode?: ApprovalMode
  reviewer?: (
    request: ApprovalRequest,
    signal: AbortSignal,
  ) => Promise<ApprovalReview>
  policy?: string
}
export interface Observer {
  event(event: import('./core-types.ts').RuntimeEvent): void
  flush(): Promise<void>
}
export interface ShellOptions {
  cwd?: string
  provider?: Provider
  context?: ThreadContext
  contextBudget?: number
  maxOutputTokens?: number
  maxTurns?: number
  extensions?: import('./extensions.ts').Extension[]
  onEvent?: (event: import('./core-types.ts').RuntimeEvent) => void
  observer?: Observer
  approval?: ApprovalOptions
  beforeAction?: (action: ActionInvocation) => Promise<void>
}
export interface WaitResult {
  reason: 'settled' | 'message'
  thread: Handle
  state: State
  messages: HistoryMessage[]
}
