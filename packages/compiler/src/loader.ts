import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import type {Root} from 'mdast'
import {checkFile, compile} from './compiler.ts'
import {hasErrors, MarkScriptCompilationError} from './diagnostics.ts'
import {imageAssetFilter, loadImageAssetModule} from './image-assets.ts'
import type {RunOptions} from './types.ts'

const registryKey = Symbol.for('markscript.module-loader')
const registryGlobal = globalThis as unknown as Record<symbol, unknown>
registryGlobal[registryKey] ??= {
  installed: false,
  sources: new Map<string, string>(),
  imports: new Map<string, string>(),
}
const registry = registryGlobal[registryKey] as {
  installed: boolean
  sources: Map<string, string>
  imports: Map<string, string>
}
const moduleSources = registry.sources
/** Register an immutable in-memory module under its absolute source identity. */
export function registerModuleSource(filename: string, source: string): void {
  const absolute = path.resolve(filename)
  if (moduleSources.has(absolute) && moduleSources.get(absolute) !== source)
    throw new Error(`Module identity already registered: ${absolute}`)
  moduleSources.set(absolute, source)
}
export function registeredModuleSources(): ReadonlyMap<string, string> {
  return moduleSources
}

export function installBunLoader(
  imports: ReadonlyMap<string, string> = new Map(),
): void {
  for (const [specifier, target] of imports)
    registry.imports.set(specifier, target)
  if (registry.installed) return
  if (typeof Bun === 'undefined' || typeof Bun.plugin !== 'function') {
    throw new Error('MarkScript run requires Bun and its runtime plugin API.')
  }

  const runtimeImports = registry.imports
  for (const name of [
    '@markscript/runtime',
    '@markscript/runtime/jsx-runtime',
    '@markscript/runtime/jsx-dev-runtime',
  ])
    runtimeImports.set(name, fileURLToPath(import.meta.resolve(name)))
  Bun.plugin({
    name: 'markscript-ms-loader',
    setup(build) {
      build.onResolve({filter: /\.ms$/u}, ({path: specifier, importer}) => {
        const absolute = path.resolve(
          importer ? path.dirname(importer) : process.cwd(),
          specifier,
        )
        if (moduleSources.has(absolute)) return {path: absolute}
        return undefined
      })
      build.onLoad({filter: imageAssetFilter}, async ({path: filename}) => ({
        contents: await loadImageAssetModule(filename),
        loader: 'js',
      }))
      build.onLoad({filter: /\.ms$/u}, async ({path: filename}) => {
        const source = moduleSources.get(filename) ?? (await readFile(filename))
        const result = await compile(source, {
          filename,
          typeCheck: false,
          sourceMap: moduleSources.has(filename),
          runtimeImports,
        })
        if (hasErrors(result.diagnostics)) {
          throw new MarkScriptCompilationError(result.diagnostics)
        }
        return {
          contents:
            result.code +
            (result.map
              ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(result.map).toString('base64')}`
              : ''),
          loader: 'js',
        }
      })
    },
  })
  registry.installed = true
}

export async function runFile(
  filename: string,
  options: Omit<RunOptions, 'filename'> = {},
): Promise<Root> {
  const absolute = path.resolve(filename)
  if (options.check !== false) {
    const diagnostics = await checkFile(absolute, options)
    if (hasErrors(diagnostics)) {
      throw new MarkScriptCompilationError(diagnostics)
    }
  }

  installBunLoader()
  const url = pathToFileURL(absolute)
  const module = (await import(url.href)) as {default?: unknown}
  if (typeof module.default !== 'function') {
    throw new TypeError(
      `Compiled MarkScript module ${absolute} lacks a default document entry function.`,
    )
  }

  return (await module.default(options.input)) as Root
}
