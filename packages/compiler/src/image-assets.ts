import {readFile} from 'node:fs/promises'
import {dirname, extname, normalize, resolve} from 'node:path'

const IMAGE_MEDIA_TYPES = new Map([
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
])

export const imageAssetFilter = /\.(?:bmp|gif|jpe?g|png|svg)$/iu

export const imageAssetTypeScriptModule =
  'declare const source: string\nexport default source\n'

export function resolveImageAssetImport(
  specifier: string,
  containingFile: string,
  fileExists: (filename: string) => boolean,
): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return undefined
  }
  if (!imageMediaType(specifier)) return undefined
  const filename = normalize(resolve(dirname(containingFile), specifier))
  return fileExists(filename) ? filename : undefined
}

export function imageAssetVirtualFilename(filename: string): string {
  return `${filename}.d.ts`
}

export async function loadImageAssetModule(filename: string): Promise<string> {
  const mediaType = imageMediaType(filename)
  if (!mediaType) {
    throw new TypeError(`Unsupported image asset ${JSON.stringify(filename)}`)
  }
  const data = await readFile(filename)
  const source = `data:${mediaType};base64,${data.toString('base64')}`
  return `export default ${JSON.stringify(source)}\n`
}

function imageMediaType(filename: string): string | undefined {
  return IMAGE_MEDIA_TYPES.get(extname(filename).toLowerCase())
}
