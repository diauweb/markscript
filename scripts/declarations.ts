import path from 'node:path'
import ts from 'typescript'

export function emitDeclarations(configPath: string): void {
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) failTypeScriptBuild([read.error])

  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  )
  if (parsed.errors.length > 0) failTypeScriptBuild(parsed.errors)

  const programOptions: ts.CreateProgramOptions = {
    rootNames: parsed.fileNames,
    options: parsed.options,
  }
  if (parsed.projectReferences) {
    programOptions.projectReferences = parsed.projectReferences
  }
  const program = ts.createProgram(programOptions)
  const emitted = program.emit()
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program),
    ...emitted.diagnostics,
  ]
  if (diagnostics.length > 0) failTypeScriptBuild(diagnostics)
}

function failTypeScriptBuild(diagnostics: readonly ts.Diagnostic[]): never {
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (filename) => filename,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  }
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host))
}
