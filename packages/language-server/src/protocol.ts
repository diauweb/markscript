import {isAbsolute, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import type {Diagnostic as CompilerDiagnostic} from '@markscript/compiler'
import {manualDocumentationUrl} from '@markscript/manuals'
import {
  DiagnosticSeverity,
  type Position,
  type Diagnostic as ProtocolDiagnostic,
  type Range,
} from '@volar/language-server/node'

/** Convert MarkScript's one-based UTF-16 source coordinates to an LSP range. */
export function compilerRange(diagnostic: CompilerDiagnostic): Range {
  const start = compilerPosition(diagnostic.line, diagnostic.column)
  let end = compilerPosition(
    diagnostic.endLine ?? diagnostic.line,
    diagnostic.endColumn ?? diagnostic.column,
  )

  // Diagnostics without a span still point at an inclusive source position.
  // LSP ranges are end-exclusive, so select one UTF-16 code unit.
  if (comparePositions(end, start) <= 0) {
    end = {line: start.line, character: start.character + 1}
  }

  return {start, end}
}

export function compilerDiagnosticToProtocol(
  diagnostic: CompilerDiagnostic,
): ProtocolDiagnostic {
  const documentationUrl = manualDocumentationUrl(String(diagnostic.code))
  const converted: ProtocolDiagnostic = {
    range: compilerRange(diagnostic),
    severity:
      diagnostic.severity === 'warning'
        ? DiagnosticSeverity.Warning
        : DiagnosticSeverity.Error,
    source: diagnostic.source,
    code: diagnostic.code,
    message: diagnostic.message,
  }
  if (documentationUrl !== undefined) {
    converted.codeDescription = {href: documentationUrl}
  }
  return converted
}

/**
 * Split diagnostics returned while checking one document by their actual
 * source file. Imported `.ms` modules therefore receive diagnostics on their
 * authored URI.
 */
export function groupCompilerDiagnostics(
  ownerUri: string,
  ownerFilename: string,
  diagnostics: readonly CompilerDiagnostic[],
): Map<string, ProtocolDiagnostic[]> {
  const groups = new Map<string, ProtocolDiagnostic[]>()
  groups.set(ownerUri, [])

  for (const diagnostic of diagnostics) {
    const uri = sourceUri(ownerUri, ownerFilename, diagnostic.filename)
    const group = groups.get(uri)
    const converted = compilerDiagnosticToProtocol(diagnostic)
    if (group) group.push(converted)
    else groups.set(uri, [converted])
  }

  return groups
}

function compilerPosition(
  line: number | undefined,
  column: number | undefined,
): Position {
  return {
    line: Math.max(0, (line ?? 1) - 1),
    character: Math.max(0, (column ?? 1) - 1),
  }
}

function comparePositions(left: Position, right: Position): number {
  return left.line === right.line
    ? left.character - right.character
    : left.line - right.line
}

function sourceUri(
  ownerUri: string,
  ownerFilename: string,
  diagnosticFilename: string | undefined,
): string {
  if (!diagnosticFilename) return ownerUri

  const filename = absoluteDiagnosticFilename(ownerFilename, diagnosticFilename)
  if (sameFilename(filename, ownerFilename)) return ownerUri
  return pathToFileURL(filename).href
}

function absoluteDiagnosticFilename(
  ownerFilename: string,
  diagnosticFilename: string,
): string {
  if (diagnosticFilename.startsWith('file:')) {
    try {
      return fileURLToPath(diagnosticFilename)
    } catch {
      return diagnosticFilename
    }
  }

  return isAbsolute(diagnosticFilename)
    ? resolve(diagnosticFilename)
    : resolve(ownerFilename, '..', diagnosticFilename)
}

function sameFilename(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}
