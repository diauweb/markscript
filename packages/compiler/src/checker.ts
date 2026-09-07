import {dirname, isAbsolute, join, normalize, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import {typescriptDiagnostic} from './diagnostics.ts'
import {generateModule} from './generate.ts'
import {
  imageAssetTypeScriptModule,
  imageAssetVirtualFilename,
  resolveImageAssetImport,
} from './image-assets.ts'
import {parseMarkscript} from './parser.ts'
import {mapTypeScriptDiagnostic} from './source-mapping.ts'
import type {CompilerOptions, Diagnostic, GeneratedSourceSpan} from './types.ts'

const standaloneOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: '@markscript/runtime',
  allowImportingTsExtensions: true,
  strict: true,
  skipLibCheck: true,
  verbatimModuleSyntax: true,
  types: ['bun'],
  noEmit: true,
}

const compilerModulePath = fileURLToPath(import.meta.url)
const generatedRuntimeImports = new Set([
  '@markscript/runtime',
  '@markscript/runtime/jsx-runtime',
  '@markscript/runtime/jsx-dev-runtime',
])

interface ProjectConfiguration {
  configPath?: string
  diagnostics: ts.Diagnostic[]
  ambientFileNames: string[]
  options: ts.CompilerOptions
  projectReferences?: readonly ts.ProjectReference[]
}

interface VirtualModule {
  originalPath: string
  virtualPath: string
  source: string
  virtualCode: string
  spans: readonly GeneratedSourceSpan[]
  diagnostics: Diagnostic[]
}

interface VirtualCompilerHost {
  host: ts.CompilerHost
  modules: Map<string, VirtualModule>
}

/**
 * Type-check a generated MarkScript module without evaluating it or loading
 * TypeScript language-service plugins.
 *
 * Identity spans supplied by the frontend map diagnostics in copied
 * TypeScript/TSX regions back to their original `.ms` line and column.
 */
export function checkVirtualModule(
  virtualCode: string,
  virtualFilename: string,
  originalFilename: string,
  originalSource: string,
  spans: readonly GeneratedSourceSpan[],
  options: CompilerOptions = {},
): Diagnostic[] {
  const originalPath = absolutePath(originalFilename)
  const virtualPath = absolutePath(virtualFilename)
  const configuration = readProjectConfiguration(originalPath, options.tsconfig)

  if (
    configuration.configPath &&
    configuration.options.configFilePath === undefined
  ) {
    configuration.options.configFilePath = configuration.configPath
  }

  const compilerOptions: ts.CompilerOptions = {
    ...(configuration.configPath ? configuration.options : standaloneOptions),
    ...options.compilerOptions,

    // These options describe MarkScript's language/runtime boundary independent
    // of a host project's JSX emitter. `noEmit` keeps checking artifact-free.
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@markscript/runtime',
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    verbatimModuleSyntax: true,
    noEmit: true,

    // Static checking uses a plugin-free program for consistent future adapters.
    plugins: [],
  }

  const rootModule: VirtualModule = {
    originalPath,
    virtualPath,
    source: originalSource,
    virtualCode,
    spans,
    diagnostics: [],
  }
  const virtualHost = createVirtualCompilerHost(
    compilerOptions,
    rootModule,
    options.sourceOverrides,
  )
  const programOptions: ts.CreateProgramOptions = {
    // A file-oriented MarkScript check reports its reachable graph while
    // project-owned ambient declarations supply the configured type environment.
    rootNames: [virtualPath, ...configuration.ambientFileNames],
    options: compilerOptions,
    host: virtualHost.host,
  }

  if (configuration.projectReferences) {
    programOptions.projectReferences = configuration.projectReferences
  }

  const program = ts.createProgram(programOptions)
  const importedFrontendDiagnostics = [...virtualHost.modules.values()]
    .filter((module) => module !== rootModule)
    .flatMap((module) => module.diagnostics)
  const diagnostics = [
    ...configuration.diagnostics.map((diagnostic) =>
      typescriptDiagnostic(
        diagnostic,
        ts,
        diagnostic.file?.fileName ??
          configuration.configPath ??
          originalFilename,
      ),
    ),
    ...importedFrontendDiagnostics,
    ...ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const module = diagnostic.file
        ? virtualHost.modules.get(canonicalPath(diagnostic.file.fileName))
        : undefined
      if (!module) {
        return typescriptDiagnostic(
          diagnostic,
          ts,
          diagnostic.file?.fileName ?? originalFilename,
        )
      }

      return mapTypeScriptDiagnostic(
        diagnostic,
        ts,
        module.virtualPath,
        module.originalPath,
        module.virtualCode,
        module.source,
        module.spans,
      )
    }),
  ]

  return deduplicateDiagnostics(diagnostics)
}

function readProjectConfiguration(
  originalPath: string,
  requestedConfig: string | false | undefined,
): ProjectConfiguration {
  const configPath = resolveConfigPath(originalPath, requestedConfig)
  if (!configPath) {
    return {
      ambientFileNames: [],
      diagnostics: [],
      options: {...standaloneOptions},
    }
  }

  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) {
    return {
      configPath,
      ambientFileNames: [],
      diagnostics: [read.error],
      options: {...standaloneOptions},
    }
  }

  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath,
  )

  const result: ProjectConfiguration = {
    configPath,
    ambientFileNames: parsed.fileNames.filter(isDeclarationFile),
    // The explicit virtual `.ms.tsx` module is the program root. TypeScript's
    // config parser recognizes the explicit virtual `.ms.tsx` root through the
    // checker host. Filter its inapplicable TS18003 result and retain genuine
    // configuration errors.
    diagnostics: parsed.errors.filter(
      (diagnostic) => diagnostic.code !== 18003,
    ),
    options: parsed.options,
  }

  if (parsed.projectReferences) {
    result.projectReferences = parsed.projectReferences
  }

  return result
}

function isDeclarationFile(filename: string): boolean {
  return /\.d\.(?:c|m)?ts$/u.test(filename)
}

function scriptKind(filename: string): ts.ScriptKind {
  if (/\.tsx$/iu.test(filename)) return ts.ScriptKind.TSX
  if (/\.jsx$/iu.test(filename)) return ts.ScriptKind.JSX
  if (/\.(?:js|mjs|cjs)$/iu.test(filename)) return ts.ScriptKind.JS
  if (/\.json$/iu.test(filename)) return ts.ScriptKind.JSON
  return ts.ScriptKind.TS
}

function resolveConfigPath(
  originalPath: string,
  requestedConfig: string | false | undefined,
): string | undefined {
  if (requestedConfig === false) return undefined

  if (requestedConfig !== undefined) {
    const candidate = absolutePath(requestedConfig)
    return ts.sys.directoryExists?.(candidate)
      ? join(candidate, 'tsconfig.json')
      : candidate
  }

  return ts.findConfigFile(dirname(originalPath), ts.sys.fileExists)
}

function createVirtualCompilerHost(
  compilerOptions: ts.CompilerOptions,
  rootModule: VirtualModule,
  sourceOverrides: ReadonlyMap<string, string> | undefined,
): VirtualCompilerHost {
  const host = ts.createCompilerHost(compilerOptions, true)
  const baseFileExists = host.fileExists.bind(host)
  const baseReadFile = host.readFile.bind(host)
  const baseGetSourceFile = host.getSourceFile.bind(host)
  const baseRealpath = host.realpath?.bind(host)
  const modules = new Map<string, VirtualModule>()
  const modulesByOriginalPath = new Map<string, VirtualModule>()
  const sourceFiles = new Map<string, ts.SourceFile>()
  const overrides = new Map<string, string>()

  for (const [filename, source] of sourceOverrides ?? []) {
    overrides.set(canonicalPath(filename), source)
  }
  const markscriptFileExists = (filename: string) =>
    overrides.has(canonicalPath(filename)) || baseFileExists(filename)

  registerModule(rootModule)

  const virtualModuleFor = (fileName: string) =>
    modules.get(canonicalPath(fileName))

  host.fileExists = (fileName) =>
    virtualModuleFor(fileName) !== undefined ||
    overrides.has(canonicalPath(fileName)) ||
    baseFileExists(fileName)

  host.readFile = (fileName) => {
    const module = virtualModuleFor(fileName)
    return (
      module?.virtualCode ??
      overrides.get(canonicalPath(fileName)) ??
      baseReadFile(fileName)
    )
  }

  host.getSourceFile = (
    fileName,
    languageVersionOrOptions,
    onError,
    shouldCreateNewSourceFile,
  ) => {
    const module = virtualModuleFor(fileName)
    if (!module) {
      const override = overrides.get(canonicalPath(fileName))
      if (override !== undefined) {
        const canonicalFileName = canonicalPath(fileName)
        let sourceFile = sourceFiles.get(canonicalFileName)
        if (!sourceFile || shouldCreateNewSourceFile) {
          sourceFile = ts.createSourceFile(
            fileName,
            override,
            languageVersionOrOptions,
            true,
            scriptKind(fileName),
          )
          sourceFiles.set(canonicalFileName, sourceFile)
        }
        return sourceFile
      }
      return baseGetSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile,
      )
    }

    const canonicalFileName = canonicalPath(module.virtualPath)
    let sourceFile = sourceFiles.get(canonicalFileName)
    if (!sourceFile || shouldCreateNewSourceFile) {
      sourceFile = ts.createSourceFile(
        module.virtualPath,
        module.virtualCode,
        languageVersionOrOptions,
        true,
        ts.ScriptKind.TSX,
      )
      sourceFiles.set(canonicalFileName, sourceFile)
    }

    return sourceFile
  }

  if (baseRealpath) {
    host.realpath = (fileName) => {
      const module = virtualModuleFor(fileName)
      return module?.virtualPath ?? baseRealpath(fileName)
    }
  }

  // Checking is intentionally read-only even if a future caller accidentally
  // asks this host to emit.
  host.writeFile = () => {}

  const resolutionHost: ts.ModuleResolutionHost = host
  const resolutionCache = ts.createModuleResolutionCache(
    dirname(rootModule.originalPath),
    host.getCanonicalFileName,
    compilerOptions,
  )

  host.getModuleResolutionCache = () => resolutionCache
  host.resolveModuleNameLiterals = (
    moduleLiterals,
    containingFile,
    redirectedReference,
    resolutionOptions,
    containingSourceFile,
  ) => {
    const containingModule = virtualModuleFor(containingFile)
    const resolutionBase = containingModule?.originalPath ?? containingFile

    return moduleLiterals.map((moduleLiteral) => {
      const resolutionMode = ts.getModeForUsageLocation(
        containingSourceFile,
        moduleLiteral,
        resolutionOptions,
      )
      const importedAsset = resolveImageAssetImport(
        moduleLiteral.text,
        resolutionBase,
        baseFileExists,
      )
      if (importedAsset) {
        const module = loadImageAssetModule(importedAsset)
        return {
          resolvedModule: {
            resolvedFileName: module.virtualPath,
            extension: ts.Extension.Dts,
            isExternalLibraryImport: false,
          },
        }
      }

      const importedMarkscript = resolveMarkscriptImport(
        moduleLiteral.text,
        resolutionBase,
        resolutionOptions,
        resolutionHost,
        markscriptFileExists,
        redirectedReference,
        resolutionMode,
      )
      if (importedMarkscript) {
        const module = loadMarkscriptModule(importedMarkscript)
        if (module) {
          return {
            resolvedModule: {
              resolvedFileName: module.virtualPath,
              extension: ts.Extension.Tsx,
              isExternalLibraryImport: false,
            },
          }
        }
      }

      const resolved = ts.resolveModuleName(
        moduleLiteral.text,
        resolutionBase,
        resolutionOptions,
        resolutionHost,
        resolutionCache,
        redirectedReference,
        resolutionMode,
      )

      // These imports are injected by the MarkScript generator. Prefer the
      // host project's runtime, with the compiler's runtime dependency as the
      // fallback for transitive workspace and package-manager layouts.
      if (
        generatedRuntimeImports.has(moduleLiteral.text) &&
        !isDeclarationResolution(resolved.resolvedModule)
      ) {
        const fallback = ts.resolveModuleName(
          moduleLiteral.text,
          compilerModulePath,
          resolutionOptions,
          resolutionHost,
          resolutionCache,
          redirectedReference,
          resolutionMode,
        )
        if (isDeclarationResolution(fallback.resolvedModule)) return fallback
        if (!resolved.resolvedModule) return fallback
      }

      return resolved
    })
  }

  return {host, modules}

  function registerModule(module: VirtualModule): void {
    modules.set(canonicalPath(module.virtualPath), module)
    modulesByOriginalPath.set(canonicalPath(module.originalPath), module)
  }

  function loadMarkscriptModule(
    originalPath: string,
  ): VirtualModule | undefined {
    const canonicalOriginalPath = canonicalPath(originalPath)
    const cached = modulesByOriginalPath.get(canonicalOriginalPath)
    if (cached) return cached

    const source =
      overrides.get(canonicalOriginalPath) ?? ts.sys.readFile(originalPath)
    if (source === undefined) return undefined

    const parsed = parseMarkscript(source, originalPath)
    if (!parsed.tree) {
      const invalidModule: VirtualModule = {
        originalPath,
        virtualPath: `${originalPath}.tsx`,
        source,
        // Keep the import resolved and preserve the original parse diagnostic.
        virtualCode: 'export {}\n',
        spans: [],
        diagnostics: parsed.diagnostics,
      }
      registerModule(invalidModule)
      return invalidModule
    }

    const generated = generateModule(parsed.tree, source, originalPath)
    const module: VirtualModule = {
      originalPath,
      virtualPath: generated.virtualFilename,
      source,
      virtualCode: generated.virtualCode,
      spans: generated.spans,
      diagnostics: [...parsed.diagnostics, ...generated.diagnostics],
    }
    registerModule(module)
    return module
  }

  function loadImageAssetModule(originalPath: string): VirtualModule {
    const canonicalOriginalPath = canonicalPath(originalPath)
    const cached = modulesByOriginalPath.get(canonicalOriginalPath)
    if (cached) return cached
    const module: VirtualModule = {
      originalPath,
      virtualPath: imageAssetVirtualFilename(originalPath),
      source: '',
      virtualCode: imageAssetTypeScriptModule,
      spans: [],
      diagnostics: [],
    }
    registerModule(module)
    return module
  }
}

function isDeclarationResolution(
  module: ts.ResolvedModuleFull | undefined,
): boolean {
  return module !== undefined && /\.d\.[cm]?ts$/u.test(module.resolvedFileName)
}

function resolveMarkscriptImport(
  specifier: string,
  containingFile: string,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  fileExists: (filename: string) => boolean,
  redirectedReference: ts.ResolvedProjectReference | undefined,
  resolutionMode: ts.ResolutionMode,
): string | undefined {
  const resolutionHost: ts.ModuleResolutionHost = {
    fileExists(filename) {
      const original = originalMarkscriptLookup(filename, fileExists)
      return original !== undefined || host.fileExists(filename)
    },
    readFile: host.readFile.bind(host),
    ...(host.directoryExists
      ? {directoryExists: host.directoryExists.bind(host)}
      : {}),
    ...(host.getDirectories
      ? {getDirectories: host.getDirectories.bind(host)}
      : {}),
    ...(host.realpath ? {realpath: host.realpath.bind(host)} : {}),
  }
  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    options,
    resolutionHost,
    undefined,
    redirectedReference,
    resolutionMode,
  ).resolvedModule?.resolvedFileName
  const original = resolved
    ? originalMarkscriptLookup(resolved, fileExists)
    : undefined
  if (original) return original
  if (
    !specifier.endsWith('.ms') ||
    (!specifier.startsWith('./') && !specifier.startsWith('../'))
  ) {
    return undefined
  }

  return normalize(resolve(dirname(containingFile), specifier))
}

function originalMarkscriptLookup(
  filename: string,
  fileExists: (filename: string) => boolean,
): string | undefined {
  if (filename.endsWith('.ms') && fileExists(filename))
    return normalize(filename)
  const original = filename.endsWith('.ms.tsx')
    ? filename.slice(0, -4)
    : filename.endsWith('.ms.ts')
      ? filename.slice(0, -3)
      : undefined
  return original && fileExists(original) ? normalize(original) : undefined
}

function deduplicateDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const result: Diagnostic[] = []

  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.code,
      diagnostic.severity,
      diagnostic.filename ?? '',
      diagnostic.line ?? '',
      diagnostic.column ?? '',
      diagnostic.endLine ?? '',
      diagnostic.endColumn ?? '',
      diagnostic.message,
    ].join('\0')

    if (seen.has(key)) continue
    seen.add(key)
    result.push(diagnostic)
  }

  return result
}

function absolutePath(fileName: string): string {
  return normalize(isAbsolute(fileName) ? fileName : resolve(fileName))
}

function canonicalPath(fileName: string): string {
  const absolute = absolutePath(fileName)
  return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase()
}
