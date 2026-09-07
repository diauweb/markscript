import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'

const packageDirectory = import.meta.dir
const outputDirectory = path.join(packageDirectory, 'dist')
const manualDirectory = path.join(packageDirectory, 'manuals')

await Promise.all([
  mkdir(outputDirectory, {recursive: true}),
  mkdir(manualDirectory, {recursive: true}),
])

await build({
  label: 'extension client',
  entrypoint: path.join(packageDirectory, 'src/extension.ts'),
  target: 'node',
  format: 'cjs',
  filename: 'extension.cjs',
  external: ['vscode'],
})

await build({
  label: 'language server',
  entrypoint: path.join(packageDirectory, '../language-server/src/server.ts'),
  target: 'bun',
  format: 'esm',
  filename: 'server.js',
})

await build({
  label: 'command-line host',
  entrypoint: path.join(packageDirectory, '../markscript/src/cli.ts'),
  target: 'bun',
  format: 'esm',
  filename: 'cli.js',
})

await copyEmbeddedTypeEnvironment()
await copyManualSources()

interface BuildOptions {
  label: string
  entrypoint: string
  target: 'bun' | 'node'
  format: 'esm' | 'cjs'
  filename: string
  external?: string[]
}

async function build(options: BuildOptions): Promise<void> {
  const result = await Bun.build({
    entrypoints: [options.entrypoint],
    outdir: outputDirectory,
    target: options.target,
    format: options.format,
    packages: 'bundle',
    ...(options.external ? {external: options.external} : {}),
    sourcemap: 'external',
    naming: {entry: options.filename},
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`Failed to build ${options.label}`)
  }

  console.log(`Built ${options.label} at dist/${options.filename}`)
}

async function copyManualSources(): Promise<void> {
  const sourceDirectory = path.join(packageDirectory, '../manuals/manuals')
  const filenames = (await readdir(sourceDirectory, {recursive: true}))
    .filter((filename) => filename.endsWith('.ms'))
    .sort()

  if (filenames.length === 0) {
    throw new Error('No authored .ms manual pages found')
  }

  await rm(manualDirectory, {recursive: true, force: true})
  await mkdir(manualDirectory, {recursive: true})
  for (const filename of filenames) {
    const destination = path.join(manualDirectory, filename)
    await mkdir(path.dirname(destination), {recursive: true})
    await copyFile(path.join(sourceDirectory, filename), destination)
  }
  console.log(`Copied ${filenames.length} manual sources to manuals/`)
}

interface EmbeddedPackage {
  destination: string
  source: string
  runtimeDeclarations?: boolean
}

interface EmbeddedFile {
  destination: string
  source: string
}

async function copyEmbeddedTypeEnvironment(): Promise<void> {
  const embeddedRoot = path.join(outputDirectory, 'node_modules')
  const manifestPath = path.join(
    outputDirectory,
    '.generated-type-environment.json',
  )
  const runtimePackage = path.join(packageDirectory, '../runtime')
  const compilerPackage = path.join(packageDirectory, '../compiler')
  const mdastTypes = resolvePackageDependency(runtimePackage, '@types/mdast')
  const unistTypes = resolvePackageDependency(mdastTypes, '@types/unist')
  const bunTypesPackage = resolvePackageDependency(
    compilerPackage,
    '@types/bun',
  )
  const bunTypes = resolvePackageDependency(bunTypesPackage, 'bun-types')
  const nodeTypes = resolvePackageDependency(bunTypes, '@types/node')
  const undiciTypes = resolvePackageDependency(nodeTypes, 'undici-types')
  const packages: EmbeddedPackage[] = [
    {
      destination: '@markscript/runtime',
      source: runtimePackage,
      runtimeDeclarations: true,
    },
    {destination: '@types/mdast', source: mdastTypes},
    {destination: '@types/unist', source: unistTypes},
    {destination: '@types/bun', source: bunTypesPackage},
    {destination: 'bun-types', source: bunTypes},
    {destination: '@types/node', source: nodeTypes},
    {destination: 'undici-types', source: undiciTypes},
  ]

  const files = (await Promise.all(packages.map(collectEmbeddedPackageFiles)))
    .flat()
    .sort((left, right) => left.destination.localeCompare(right.destination))
  const destinations = files.map((file) => file.destination)
  const currentDestinations = new Set(destinations)
  if (currentDestinations.size !== destinations.length) {
    throw new Error('Embedded type packages produced duplicate output paths')
  }

  const previousDestinations = await readEmbeddedTypeManifest(manifestPath)
  for (const destination of previousDestinations) {
    if (!currentDestinations.has(destination)) {
      await rm(embeddedPath(embeddedRoot, destination), {force: true})
    }
  }

  for (const file of files) {
    const destination = embeddedPath(embeddedRoot, file.destination)
    await mkdir(path.dirname(destination), {recursive: true})
    await copyFile(file.source, destination)
  }
  await writeFile(manifestPath, `${JSON.stringify(destinations, null, 2)}\n`)
  console.log(
    `Embedded ${packages.length} declaration packages (${files.length} files)`,
  )
}

async function collectEmbeddedPackageFiles(
  embeddedPackage: EmbeddedPackage,
): Promise<EmbeddedFile[]> {
  const files: EmbeddedFile[] = []
  await visit(embeddedPackage.source, '')
  return files

  async function visit(
    directory: string,
    relativeDirectory: string,
  ): Promise<void> {
    const entries = await readdir(directory, {withFileTypes: true})
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name)
      const source = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(source, relativePath)
      } else if (
        entry.isFile() &&
        shouldEmbedPackageFile(
          relativePath,
          embeddedPackage.runtimeDeclarations,
        )
      ) {
        files.push({
          destination: path.posix.join(
            embeddedPackage.destination,
            relativePath,
          ),
          source,
        })
      }
    }
  }
}

function shouldEmbedPackageFile(
  relativePath: string,
  runtimeDeclarations = false,
): boolean {
  if (relativePath === 'package.json') return true
  if (/^(?:LICENSE|LICENCE)(?:\..*)?$/iu.test(relativePath)) return true
  if (!/\.d\.[cm]?ts$/u.test(relativePath)) return false
  return !runtimeDeclarations || relativePath.startsWith('types/')
}

function resolvePackageDependency(
  packageDirectory: string,
  dependency: string,
): string {
  const manifestPath = path.join(packageDirectory, 'package.json')
  return path.dirname(
    createRequire(manifestPath).resolve(`${dependency}/package.json`),
  )
}

async function readEmbeddedTypeManifest(
  manifestPath: string,
): Promise<string[]> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (isMissingFileError(error)) return []
    throw error
  }

  if (!Array.isArray(value) || !value.every(isSafeEmbeddedPath)) {
    throw new Error(`Invalid embedded type manifest: ${manifestPath}`)
  }
  return value
}

function isSafeEmbeddedPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    value
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

function embeddedPath(root: string, relativePath: string): string {
  if (!isSafeEmbeddedPath(relativePath)) {
    throw new Error(`Unsafe embedded type path: ${relativePath}`)
  }
  return path.join(root, ...relativePath.split('/'))
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
