import type ts from 'typescript'
import type {Position} from 'unist'
import type {Diagnostic} from './types.ts'

/** A non-executing compile/check failure with structured diagnostics for tools. */
export class MarkScriptCompilationError extends Error {
  readonly diagnostics: readonly Diagnostic[]

  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join('\n'))
    this.name = 'MarkScriptCompilationError'
    this.diagnostics = [...diagnostics]
  }
}

export function markscriptDiagnostic(
  code: string,
  message: string,
  filename: string,
  position?: Position,
): Diagnostic {
  const diagnostic: Diagnostic = {
    code,
    severity: 'error',
    source: 'markscript',
    message,
    filename,
  }

  if (position) {
    diagnostic.line = position.start.line
    diagnostic.column = position.start.column
    diagnostic.endLine = position.end.line
    diagnostic.endColumn = position.end.column
  }

  return diagnostic
}

export function typescriptDiagnostic(
  diagnostic: ts.Diagnostic,
  tsApi: typeof ts,
  filename: string,
): Diagnostic {
  const result: Diagnostic = {
    code: `TS${diagnostic.code}`,
    severity:
      diagnostic.category === tsApi.DiagnosticCategory.Warning
        ? 'warning'
        : 'error',
    source: 'typescript',
    message: tsApi.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    filename,
  }

  if (diagnostic.file && diagnostic.start !== undefined) {
    const start = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    )
    const end = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start + (diagnostic.length ?? 0),
    )
    result.line = start.line + 1
    result.column = start.character + 1
    result.endLine = end.line + 1
    result.endColumn = end.character + 1
  }

  return result
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.filename
    ? `${diagnostic.filename}${
        diagnostic.line === undefined
          ? ''
          : `:${diagnostic.line}:${diagnostic.column ?? 1}`
      }`
    : ''
  const prefix = location ? `${location} - ` : ''
  return `${prefix}${diagnostic.code}: ${diagnostic.message}`
}
