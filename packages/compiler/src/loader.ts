import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import type {Root} from 'mdast'
import {checkFile, compile} from './compiler.ts'
import {hasErrors, MarkScriptCompilationError} from './diagnostics.ts'
import {imageAssetFilter, loadImageAssetModule} from './image-assets.ts'
import type {RunOptions} from './types.ts'

let loaderInstalled = false

export function installBunLoader(): void {
  if (loaderInstalled) return
  if (typeof Bun === 'undefined' || typeof Bun.plugin !== 'function') {
    throw new Error('MarkScript run requires Bun and its runtime plugin API.')
  }

  Bun.plugin({
    name: 'markscript-ms-loader',
    setup(build) {
      build.onLoad({filter: imageAssetFilter}, async ({path: filename}) => ({
        contents: await loadImageAssetModule(filename),
        loader: 'js',
      }))
      build.onLoad({filter: /\.ms$/u}, async ({path: filename}) => {
        const source = await readFile(filename)
        const result = await compile(source, {
          filename,
          typeCheck: false,
          sourceMap: false,
        })
        if (hasErrors(result.diagnostics)) {
          throw new MarkScriptCompilationError(result.diagnostics)
        }
        return {contents: result.code, loader: 'js'}
      })
    },
  })
  loaderInstalled = true
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

  return (await module.default()) as Root
}
