/** Stable runtime diagnostic codes used by MarkScript's executable boundary. */
export type RuntimeErrorCode =
  | 'ERR1101'
  | 'ERR1102'
  | 'ERR1103'
  | 'ERR1104'
  | 'ERR1105'
  | 'ERR1201'
  | 'ERR1202'
  | 'ERR1301'

export interface RuntimeSourceLocation {
  readonly fileName?: string
  readonly lineNumber?: number
  readonly columnNumber?: number
}

export interface RuntimeErrorOptions {
  readonly path?: string | undefined
  readonly source?: RuntimeSourceLocation | undefined
  readonly cause?: unknown
}

/** An execution-time language error, distinct from an exception thrown by user code. */
export class MarkScriptRuntimeError extends Error {
  readonly code: RuntimeErrorCode
  readonly path: string | undefined
  readonly source: RuntimeSourceLocation | undefined

  constructor(
    code: RuntimeErrorCode,
    message: string,
    options: RuntimeErrorOptions = {},
  ) {
    const pathSuffix = options.path === undefined ? '' : ` at ${options.path}`
    const sourceSuffix = formatSource(options.source)
    const helpSuffix = `\nHelp: markscript help ${code}`
    super(`${code}: ${message}${pathSuffix}${sourceSuffix}${helpSuffix}`, {
      cause: options.cause,
    })
    this.name = 'MarkScriptRuntimeError'
    this.code = code
    this.path = options.path
    this.source = options.source
  }
}

function formatSource(source: RuntimeSourceLocation | undefined): string {
  if (source === undefined) return ''

  const file = source.fileName ?? '<unknown>'
  const line = source.lineNumber
  const column = source.columnNumber

  if (line === undefined) return ` (${file})`
  if (column === undefined) return ` (${file}:${line})`
  return ` (${file}:${line}:${column})`
}

export function runtimeError(
  code: RuntimeErrorCode,
  message: string,
  options?: RuntimeErrorOptions,
): never {
  throw new MarkScriptRuntimeError(code, message, options)
}
