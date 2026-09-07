import {randomUUID} from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import type {Nodes, Root} from 'mdast'
import {
  assertOutputPathsDoNotCollide,
  pageOutputPath,
  type SiteDefinition,
  type SitePage,
  sitePages,
  validateSite,
} from './model.ts'
import {readPublicFile, renderSitePage} from './render.ts'

export type {
  SiteDefinition,
  SiteMdastOptions,
  SiteNavigationSection,
  SitePage,
} from './model.ts'

const MANIFEST_NAME = '.msdocs-manifest.json'
const PUBLIC_OUTPUT_FILES = [
  '404.html',
  'assets/msdocs.css',
  'assets/msdocs.js',
] as const

export interface BuildSiteOptions {
  readonly outDir: string
}

export interface BuildMarkScriptSiteOptions extends BuildSiteOptions {
  readonly title?: string
  readonly project?: string
  readonly check?: boolean
}

export interface BuildSiteModuleOptions extends BuildSiteOptions {
  readonly title?: string
}

export interface BuiltSite {
  readonly directory: string
  readonly pages: number
  readonly files: readonly string[]
}

export async function buildMarkScriptSite(
  filename: string,
  options: BuildMarkScriptSiteOptions,
): Promise<BuiltSite> {
  const {runFile} = await import('@markscript/compiler')
  const runOptions: {check: boolean; tsconfig?: string} = {
    check: options.check ?? true,
  }
  if (options.project !== undefined) runOptions.tsconfig = options.project
  const root = await runFile(filename, runOptions)
  const pageTitle = documentTitle(root, path.basename(filename, '.ms'))
  const home: SitePage = {path: '', title: pageTitle, root}
  return buildSite(
    {
      title: options.title ?? pageTitle,
      home,
      sections: [],
    },
    options,
  )
}

export async function buildSiteModule(
  filename: string,
  options: BuildSiteModuleOptions,
): Promise<BuiltSite> {
  const absolute = path.resolve(filename)
  const module = (await import(pathToFileURL(absolute).href)) as {
    readonly default?: unknown
  }
  if (!isRecord(module.default)) {
    throw new Error(
      `msdocs site module must default-export a SiteDefinition object: ${absolute}`,
    )
  }
  const site = module.default as unknown as SiteDefinition
  return buildSite(
    options.title === undefined ? site : {...site, title: options.title},
    options,
  )
}

export async function buildSite(
  site: SiteDefinition,
  options: BuildSiteOptions,
): Promise<BuiltSite> {
  validateSite(site)
  const pages = sitePages(site)
  const currentFiles = [
    ...pages.map(({path: pagePath}) => pageOutputPath(pagePath)),
    ...PUBLIC_OUTPUT_FILES,
  ].sort()
  assertOutputPathsDoNotCollide(currentFiles)
  const requestedDirectory = path.resolve(options.outDir)
  if (requestedDirectory === path.parse(requestedDirectory).root) {
    throw new Error(
      `Refusing to use a filesystem root as msdocs output: ${requestedDirectory}`,
    )
  }
  await mkdir(requestedDirectory, {recursive: true})
  const requestedMetadata = await lstat(requestedDirectory)
  if (requestedMetadata.isSymbolicLink() || !requestedMetadata.isDirectory()) {
    throw new Error(
      `msdocs output must be a real directory: ${requestedDirectory}`,
    )
  }
  const directory = await realpath(requestedDirectory)
  const renderedPages = await Promise.all(
    pages.map(async (page) => ({
      filename: pageOutputPath(page.path),
      content: await renderSitePage(site, page),
    })),
  )
  const assets = await Promise.all(
    PUBLIC_OUTPUT_FILES.map(async (filename) => ({
      filename,
      content: await readPublicFile(filename),
    })),
  )
  const outputs = [...renderedPages, ...assets]
  const previousFiles = await readManifest(directory)
  const current = new Set(currentFiles)
  const previous = new Set(previousFiles)

  for (const {filename} of outputs) {
    await assertWritableOutput(directory, filename, previous.has(filename))
  }
  for (const filename of previousFiles) {
    if (!current.has(filename)) {
      await assertNoSymbolicLinks(directory, filename)
    }
  }

  // Record the union before mutation. If the process stops partway through,
  // the next build can safely recover every path this build may have touched.
  const journalFiles = [...new Set([...previousFiles, ...currentFiles])].sort()
  await writeManifest(directory, journalFiles)

  for (const output of outputs) {
    const filename = outputFilename(directory, output.filename)
    await ensureSafeParent(directory, output.filename)
    await writeFileAtomically(filename, output.content)
  }
  for (const filename of previousFiles) {
    if (!current.has(filename)) {
      await rm(outputFilename(directory, filename), {force: true})
    }
  }
  await writeManifest(directory, currentFiles)

  return Object.freeze({
    directory,
    pages: renderedPages.length,
    files: Object.freeze([...currentFiles]),
  })
}

export async function readBuiltSiteFiles(
  directory: string,
): Promise<readonly string[]> {
  const resolved = await realpath(path.resolve(directory))
  const files = await readManifest(resolved)
  if (files.length === 0) {
    throw new Error(`No built msdocs site found in ${resolved}`)
  }
  return Object.freeze(files)
}

function documentTitle(root: Root, fallback: string): string {
  const first = root.children[0]
  if (first?.type !== 'heading' || first.depth !== 1) return fallback
  const title = nodeText(first).trim()
  return title === '' ? fallback : title
}

function nodeText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('alt' in node && typeof node.alt === 'string') return node.alt
  if ('children' in node) return node.children.map(nodeText).join('')
  return ''
}

async function readManifest(directory: string): Promise<string[]> {
  let value: unknown
  try {
    await assertManifestIsSafe(directory)
    value = JSON.parse(
      await readFile(path.join(directory, MANIFEST_NAME), 'utf8'),
    )
  } catch (error) {
    if (isMissingFileError(error)) return []
    throw new Error(`${MANIFEST_NAME} read failed`, {cause: error})
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.files) ||
    !value.files.every(isSafeGeneratedPath) ||
    new Set(value.files).size !== value.files.length
  ) {
    throw new Error(`Invalid ${MANIFEST_NAME} in ${directory}`)
  }
  return value.files
}

async function writeManifest(
  directory: string,
  files: readonly string[],
): Promise<void> {
  await assertManifestIsSafe(directory)
  await writeFileAtomically(
    path.join(directory, MANIFEST_NAME),
    `${JSON.stringify({version: 1, files}, null, 2)}\n`,
  )
}

async function writeFileAtomically(
  filename: string,
  content: string | Uint8Array,
): Promise<void> {
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporary, content, {flag: 'wx'})
    await rename(temporary, filename)
  } finally {
    await rm(temporary, {force: true})
  }
}

async function assertManifestIsSafe(directory: string): Promise<void> {
  const filename = path.join(directory, MANIFEST_NAME)
  try {
    const metadata = await lstat(filename)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`${MANIFEST_NAME} must be a regular file`)
    }
  } catch (error) {
    if (isMissingFileError(error)) return
    throw error
  }
}

async function assertWritableOutput(
  directory: string,
  relative: string,
  previouslyGenerated: boolean,
): Promise<void> {
  await assertNoSymbolicLinks(directory, relative)
  const filename = outputFilename(directory, relative)
  try {
    const metadata = await lstat(filename)
    if (!metadata.isFile()) {
      throw new Error(`msdocs output target must be a file: ${filename}`)
    }
    if (!previouslyGenerated) {
      throw new Error(`Unowned msdocs output collision: ${filename}`)
    }
  } catch (error) {
    if (isMissingFileError(error)) return
    throw error
  }
}

async function assertNoSymbolicLinks(
  directory: string,
  relative: string,
): Promise<void> {
  let current = directory
  const segments = relative.split('/')
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment)
    try {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink()) {
        throw new Error(
          `Refusing to follow a symbolic link in msdocs output: ${current}`,
        )
      }
      if (index < segments.length - 1 && !metadata.isDirectory()) {
        throw new Error(`msdocs output parent must be a directory: ${current}`)
      }
    } catch (error) {
      if (isMissingFileError(error)) return
      throw error
    }
  }
}

async function ensureSafeParent(
  directory: string,
  relative: string,
): Promise<void> {
  const parentSegments = relative.split('/').slice(0, -1)
  let current = directory
  for (const segment of parentSegments) {
    current = path.join(current, segment)
    try {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`Unsafe msdocs output directory: ${current}`)
      }
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      await mkdir(current)
    }
  }
}

function outputFilename(directory: string, relative: string): string {
  if (!isSafeGeneratedPath(relative)) {
    throw new Error(`Unsafe generated site path ${JSON.stringify(relative)}`)
  }
  return path.join(directory, ...relative.split('/'))
}

function isSafeGeneratedPath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value === MANIFEST_NAME ||
    value.startsWith('/') ||
    value.startsWith('.msdocs-')
  ) {
    return false
  }
  const segments = value.split('/')
  return segments.every(
    (segment) =>
      segment !== '' &&
      segment !== '.' &&
      segment !== '..' &&
      !segment.includes('\\'),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
