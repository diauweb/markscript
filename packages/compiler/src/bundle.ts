import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {SourceMapConsumer, SourceMapGenerator} from 'source-map'
import {checkFile, compile} from './compiler.ts'
import {hasErrors} from './diagnostics.ts'
import {imageAssetFilter, loadImageAssetModule} from './image-assets.ts'
import type {CompilationResult, CompilerOptions, Diagnostic} from './types.ts'

const failedLoadMarker = 'MARKSCRIPT_BUNDLE_LOAD_FAILED:'

interface CompiledModule {
  map?: string
}

/**
 * Compile a file-backed MarkScript module graph into one ESM bundle.
 *
 * TypeScript checking runs before Bun's bundler and neither phase imports or
 * evaluates the source graph. Relative source modules are bundled while
 * package imports remain ordinary ESM imports in the output.
 */
export async function bundleFile(
  filename: string,
  options: Omit<CompilerOptions, 'filename'> = {},
): Promise<CompilationResult> {
  const absolute = path.resolve(filename)
  const diagnostics =
    options.typeCheck === false ? [] : await checkFile(absolute, options)
  if (hasErrors(diagnostics)) return {code: '', diagnostics}

  if (typeof Bun === 'undefined' || typeof Bun.build !== 'function') {
    return {
      code: '',
      diagnostics: [
        ...diagnostics,
        {
          code: 'ERR2001',
          severity: 'error',
          source: 'markscript',
          message: 'Bundled compilation requires the Bun build API.',
          filename: absolute,
        },
      ],
    }
  }

  const compiledModules = new Map<string, CompiledModule>()
  const frontendDiagnostics: Diagnostic[] = []
  const build = await Bun.build({
    entrypoints: [absolute],
    root: path.dirname(absolute),
    target: 'node',
    format: 'esm',
    packages: 'external',
    splitting: false,
    sourcemap: options.sourceMap === true ? 'external' : 'none',
    env: 'disable',
    throw: false,
    ...(typeof options.tsconfig === 'string'
      ? {tsconfig: resolveTsconfig(options.tsconfig)}
      : {}),
    plugins: [
      {
        name: 'markscript-bundle-loader',
        setup(builder) {
          builder.onLoad(
            {filter: imageAssetFilter},
            async ({path: assetPath}) => ({
              contents: await loadImageAssetModule(assetPath),
              loader: 'js',
            }),
          )
          builder.onLoad({filter: /\.ms$/u}, async ({path: modulePath}) => {
            const moduleFilename = path.resolve(modulePath)
            const source = await readFile(moduleFilename)
            const result = await compile(source, {
              ...options,
              filename: moduleFilename,
              typeCheck: false,
              // Keep a per-module map for translating Bun build diagnostics
              // from generated JavaScript back to `.ms` source.
              sourceMap: true,
            })

            frontendDiagnostics.push(...result.diagnostics)
            if (hasErrors(result.diagnostics)) {
              throw new Error(`${failedLoadMarker}${moduleFilename}`)
            }

            const compiled: CompiledModule = {}
            if (result.map) compiled.map = result.map
            compiledModules.set(canonicalPath(moduleFilename), compiled)
            return {contents: result.code, loader: 'js'}
          })
        },
      },
    ],
  })

  diagnostics.push(...frontendDiagnostics)
  diagnostics.push(
    ...(await Promise.all(
      build.logs
        .filter(
          (log) =>
            (log.level === 'error' || log.level === 'warning') &&
            !log.message.includes(failedLoadMarker),
        )
        .map((log) => buildDiagnostic(log, compiledModules)),
    )),
  )

  const entry = build.outputs.find((output) => output.kind === 'entry-point')
  if (!build.success || hasErrors(diagnostics) || !entry) {
    if (!entry && !hasErrors(diagnostics)) {
      diagnostics.push({
        code: 'ERR2002',
        severity: 'error',
        source: 'markscript',
        message: 'Bun entry-point artifact is missing.',
        filename: absolute,
      })
    }
    return {code: '', diagnostics: deduplicateDiagnostics(diagnostics)}
  }

  const result: CompilationResult = {
    code: await entry.text(),
    diagnostics: deduplicateDiagnostics(diagnostics),
  }
  if (options.sourceMap && entry.sourcemap) {
    result.map = await composeBundleSourceMap(
      await entry.sourcemap.text(),
      entry.path,
      path.dirname(absolute),
      compiledModules,
    )
  }
  return result
}

async function composeBundleSourceMap(
  bundledMap: string,
  outputPath: string,
  sourceRoot: string,
  compiledModules: ReadonlyMap<string, CompiledModule>,
): Promise<string> {
  const bundleConsumer = await new SourceMapConsumer(bundledMap)
  const moduleConsumers = new Map<string, SourceMapConsumer>()
  const generator = new SourceMapGenerator({file: path.basename(outputPath)})
  const contentSources = new Set<string>()

  try {
    for (const [filename, module] of compiledModules) {
      if (module.map) {
        moduleConsumers.set(filename, await new SourceMapConsumer(module.map))
      }
    }

    bundleConsumer.eachMapping((mapping) => {
      if (
        mapping.source === null ||
        mapping.originalLine === null ||
        mapping.originalColumn === null
      ) {
        return
      }

      const modulePath = resolveBundledSource(
        mapping.source,
        sourceRoot,
        compiledModules,
      )
      const moduleConsumer = moduleConsumers.get(canonicalPath(modulePath))
      if (moduleConsumer) {
        const original = moduleConsumer.originalPositionFor({
          line: mapping.originalLine,
          column: mapping.originalColumn,
        })
        if (
          original.source === null ||
          original.line === null ||
          original.column === null
        ) {
          return
        }

        generator.addMapping({
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn,
          },
          original: {line: original.line, column: original.column},
          source: original.source,
          ...(original.name || mapping.name
            ? {name: original.name ?? mapping.name ?? undefined}
            : {}),
        })
        copySourceContent(
          moduleConsumer,
          original.source,
          generator,
          contentSources,
        )
        return
      }

      generator.addMapping({
        generated: {
          line: mapping.generatedLine,
          column: mapping.generatedColumn,
        },
        original: {
          line: mapping.originalLine,
          column: mapping.originalColumn,
        },
        source: modulePath,
        ...(mapping.name ? {name: mapping.name} : {}),
      })
      copySourceContent(
        bundleConsumer,
        mapping.source,
        generator,
        contentSources,
        modulePath,
      )
    })
  } finally {
    bundleConsumer.destroy()
    for (const consumer of moduleConsumers.values()) consumer.destroy()
  }

  return generator.toString()
}

function copySourceContent(
  consumer: SourceMapConsumer,
  source: string,
  generator: SourceMapGenerator,
  copied: Set<string>,
  outputSource = source,
): void {
  if (copied.has(outputSource)) return
  const content = consumer.sourceContentFor(source, true)
  if (content !== null) generator.setSourceContent(outputSource, content)
  copied.add(outputSource)
}

function resolveBundledSource(
  source: string,
  sourceRoot: string,
  compiledModules: ReadonlyMap<string, CompiledModule>,
): string {
  if (source.startsWith('file:')) return fileURLToPath(source)
  if (path.isAbsolute(source)) return source

  // Bun currently records source names relative to the build process working
  // directory even when `root` is set. Prefer a path known to the MarkScript
  // loader, while retaining the configured root as a forward-compatible
  // fallback should Bun's source naming change.
  const candidates = [
    path.resolve(process.cwd(), source),
    path.resolve(sourceRoot, source),
  ]
  return (
    candidates.find((candidate) =>
      compiledModules.has(canonicalPath(candidate)),
    ) ?? path.resolve(process.cwd(), source)
  )
}

async function buildDiagnostic(
  log: BuildMessage | ResolveMessage,
  compiledModules: ReadonlyMap<string, CompiledModule>,
): Promise<Diagnostic> {
  const position = log.position
  const diagnostic: Diagnostic = {
    code: log.name === 'ResolveMessage' ? 'ERR2004' : 'ERR2003',
    severity: log.level === 'warning' ? 'warning' : 'error',
    source: 'markscript',
    message: log.message,
  }
  const filename = position?.file ? path.resolve(position.file) : undefined
  if (filename) diagnostic.filename = filename
  if (position && filename) {
    const compiled = compiledModules.get(canonicalPath(filename))
    if (compiled?.map) {
      await SourceMapConsumer.with(compiled.map, null, (consumer) => {
        const start = consumer.originalPositionFor({
          line: position.line,
          column: position.column,
        })
        const end = consumer.originalPositionFor({
          line: position.line,
          column: position.column + position.length,
        })
        if (
          start.source !== null &&
          start.line !== null &&
          start.column !== null
        ) {
          diagnostic.filename = start.source
          diagnostic.line = start.line
          diagnostic.column = start.column + 1
          diagnostic.endLine = end.line ?? start.line
          diagnostic.endColumn = (end.column ?? start.column) + 1
        }
      })
    }
  }
  if (position && diagnostic.line === undefined) {
    diagnostic.line = position.line
    diagnostic.column = position.column + 1
    diagnostic.endLine = position.line
    diagnostic.endColumn = position.column + position.length + 1
  }
  return diagnostic
}

function resolveTsconfig(requested: string): string {
  const absolute = path.resolve(requested)
  return path.extname(absolute)
    ? absolute
    : path.join(absolute, 'tsconfig.json')
}

function canonicalPath(filename: string): string {
  const normalized = path.normalize(path.resolve(filename))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function deduplicateDiagnostics(
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.source,
      diagnostic.code,
      diagnostic.filename,
      diagnostic.line,
      diagnostic.column,
      diagnostic.message,
    ].join('\0')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
