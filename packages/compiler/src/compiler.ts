import {readFile} from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import {checkVirtualModule} from './checker.ts'
import {hasErrors} from './diagnostics.ts'
import {generateModule} from './generate.ts'
import {parseMarkscript} from './parser.ts'
import {composeSourceMap, mapTypeScriptDiagnostic} from './source-mapping.ts'
import type {
  CompilationResult,
  CompilerOptions,
  Diagnostic,
  TypeScriptProjection,
} from './types.ts'

export async function check(
  source: string | Uint8Array,
  options: CompilerOptions = {},
): Promise<Diagnostic[]> {
  const input = decodeSource(source)
  const filename = resolveFilename(options.filename)
  const frontend = createTypeScriptProjection(input, filename)
  if (!frontend.generated) return frontend.diagnostics

  return [
    ...frontend.diagnostics,
    ...checkVirtualModule(
      frontend.generated.code,
      frontend.generated.filename,
      filename,
      input,
      frontend.generated.spans,
      options,
    ),
  ]
}

export async function compile(
  source: string | Uint8Array,
  options: CompilerOptions = {},
): Promise<CompilationResult> {
  const input = decodeSource(source)
  const filename = resolveFilename(options.filename)
  const frontend = createTypeScriptProjection(input, filename)

  if (!frontend.generated || hasErrors(frontend.diagnostics)) {
    return {code: '', diagnostics: frontend.diagnostics}
  }

  const diagnostics = [...frontend.diagnostics]
  if (options.typeCheck !== false) {
    diagnostics.push(
      ...checkVirtualModule(
        frontend.generated.code,
        frontend.generated.filename,
        filename,
        input,
        frontend.generated.spans,
        options,
      ),
    )
  }

  const transpiled = ts.transpileModule(frontend.generated.code, {
    fileName: frontend.generated.filename,
    reportDiagnostics: true,
    compilerOptions: {
      ...options.compilerOptions,
      target: options.compilerOptions?.target ?? ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: '@markscript/runtime',
      verbatimModuleSyntax: true,
      isolatedModules: true,
      sourceMap: options.sourceMap === true,
      inlineSources: options.sourceMap === true,
      noEmit: false,
    },
  })

  for (const diagnostic of transpiled.diagnostics ?? []) {
    diagnostics.push(
      mapTypeScriptDiagnostic(
        diagnostic,
        ts,
        frontend.generated.filename,
        filename,
        frontend.generated.code,
        input,
        frontend.generated.spans,
      ),
    )
  }

  const code = transpiled.outputText.replace(
    /\n?\/\/# sourceMappingURL=.*?(?:\r?\n|$)/gu,
    '\n',
  )
  const result: CompilationResult = {code, diagnostics}
  if (options.sourceMap && transpiled.sourceMapText) {
    result.map = await composeSourceMap(
      transpiled.sourceMapText,
      frontend.generated.code,
      input,
      filename,
      frontend.generated.spans,
    )
  }
  return result
}

export async function checkFile(
  filename: string,
  options: Omit<CompilerOptions, 'filename'> = {},
): Promise<Diagnostic[]> {
  const absolute = path.resolve(filename)
  return check(await readFile(absolute), {...options, filename: absolute})
}

export async function compileFile(
  filename: string,
  options: Omit<CompilerOptions, 'filename'> = {},
): Promise<CompilationResult> {
  const absolute = path.resolve(filename)
  return compile(await readFile(absolute), {...options, filename: absolute})
}

export function createTypeScriptProjection(
  source: string | Uint8Array,
  filename = 'document.ms',
): TypeScriptProjection {
  const input = decodeSource(source)
  const resolvedFilename = resolveFilename(filename)
  const parsed = parseMarkscript(input, resolvedFilename)
  if (!parsed.tree) {
    return {
      source: input,
      filename: resolvedFilename,
      diagnostics: parsed.diagnostics,
    }
  }
  const generated = generateModule(parsed.tree, input, resolvedFilename)
  return {
    source: input,
    filename: resolvedFilename,
    generated: {
      code: generated.virtualCode,
      filename: generated.virtualFilename,
      spans: generated.spans,
    },
    diagnostics: [...parsed.diagnostics, ...generated.diagnostics],
  }
}

function decodeSource(source: string | Uint8Array): string {
  return typeof source === 'string' ? source : new TextDecoder().decode(source)
}

function resolveFilename(filename: string | undefined): string {
  return path.resolve(filename ?? 'document.ms')
}
