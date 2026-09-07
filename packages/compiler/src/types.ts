import type {Root} from 'mdast'
import type ts from 'typescript'

export type DiagnosticSeverity = 'error' | 'warning'
export type DiagnosticSource = 'markscript' | 'typescript'

export interface Diagnostic {
  code: string
  severity: DiagnosticSeverity
  source: DiagnosticSource
  message: string
  filename?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface CompilerOptions {
  filename?: string
  compilerOptions?: ts.CompilerOptions
  tsconfig?: string | false
  /** Unsaved file contents supplied by editor hosts, keyed by source path. */
  sourceOverrides?: ReadonlyMap<string, string>
  sourceMap?: boolean
  typeCheck?: boolean
}

export interface CompilationResult {
  code: string
  map?: string
  diagnostics: Diagnostic[]
}

export interface GeneratedSourceSpan {
  generatedStart: number
  generatedEnd: number
  sourceStart: number
  sourceEnd: number
}

export interface GeneratedTypeScriptModule {
  code: string
  filename: string
  spans: readonly GeneratedSourceSpan[]
}

/**
 * A non-executing projection of MarkScript source into the TypeScript module
 * consumed by checking and editor tooling.
 */
export interface TypeScriptProjection {
  source: string
  filename: string
  generated?: GeneratedTypeScriptModule
  diagnostics: Diagnostic[]
}

export interface RunOptions extends CompilerOptions {
  check?: boolean
}

export type {Root}
