import {copyFile, mkdir, rm} from 'node:fs/promises'
import path from 'node:path'
import {emitDeclarations} from './declarations.ts'

interface PackageBuild {
  directory: string
  entrypoints: string[]
  target?: 'bun' | 'node'
  bundleDependencies?: string[]
}

const bootstrapBuilds: PackageBuild[] = [
  {
    directory: 'packages/micromark-extension-mdx-directive',
    entrypoints: ['src/index.ts'],
  },
  {
    directory: 'packages/mdast-util-mdx-directive',
    entrypoints: ['src/index.ts'],
  },
  {directory: 'packages/remark-mdx-directive', entrypoints: ['src/index.ts']},

  {
    directory: 'packages/runtime',
    entrypoints: [
      'src/index.ts',
      'src/jsx-runtime.ts',
      'src/jsx-dev-runtime.ts',
    ],
  },
  {
    directory: 'packages/compiler',
    entrypoints: ['src/index.ts', 'src/prettier.ts'],
  },
  {directory: 'packages/language-core', entrypoints: ['src/index.ts']},
]

const consumerBuilds: PackageBuild[] = [
  {
    directory: 'packages/docx',
    entrypoints: ['src/index.ts'],
    bundleDependencies: ['docx'],
  },
  {
    directory: 'packages/msdocs',
    entrypoints: ['src/index.ts', 'src/cli.ts'],
  },
  {
    directory: 'packages/markscript',
    entrypoints: ['src/index.ts', 'src/cli.ts'],
  },
  {
    directory: 'packages/language-server',
    entrypoints: ['src/server.ts'],
  },
]

for (const build of bootstrapBuilds) await buildPackage(build)

// Manual pages are themselves MarkScript programs. Generate their importable
// catalog only after the language runtime and compiler exist, then build the
// tools that directly import that compiled catalog.
await runPackageScript('packages/manuals', 'build')

for (const build of consumerBuilds) await buildPackage(build)

await runPackageScript('packages/vscode-markscript', 'build')

async function buildPackage(build: PackageBuild): Promise<void> {
  const directory = path.resolve(build.directory)
  const outdir = path.join(directory, 'dist')
  const declarationsDirectory = path.join(directory, 'types')
  await Promise.all([
    rm(outdir, {recursive: true, force: true}),
    rm(declarationsDirectory, {recursive: true, force: true}),
  ])
  await mkdir(outdir, {recursive: true})
  const manifest = await Bun.file(path.join(directory, 'package.json')).json()
  const bundled = build.bundleDependencies ?? []
  const result = await Bun.build({
    entrypoints: build.entrypoints.map((entrypoint) =>
      path.join(directory, entrypoint),
    ),
    outdir,
    target: build.target ?? 'bun',
    format: 'esm',
    packages: bundled.length > 0 ? 'bundle' : 'external',
    external: Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    }).filter((dependency) => !bundled.includes(dependency)),
    splitting: true,
    sourcemap: 'external',
    naming: {
      entry: '[name].js',
      chunk: 'chunks/[name]-[hash].js',
      asset: 'assets/[name]-[hash][ext]',
    },
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`Failed to build ${build.directory}`)
  }

  for (const dependency of bundled) {
    await copyFile(
      path.resolve(
        path.dirname(Bun.resolveSync(dependency, directory)),
        '../LICENSE',
      ),
      path.join(outdir, `${dependency}-LICENSE`),
    )
  }

  emitDeclarations(path.join(directory, 'tsconfig.build.json'))
  console.log(`Built ${build.directory}`)
}

async function runPackageScript(
  directory: string,
  script: string,
): Promise<void> {
  const child = Bun.spawn([process.execPath, 'run', script], {
    cwd: path.resolve(directory),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`Package script failed: ${directory} ${script}`)
  }
}
