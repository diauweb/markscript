import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {runTests} from '@vscode/test-electron'

// Codex and VS Code terminals can themselves be extension-host processes.
// These variables would make the downloaded Electron binary start as Node.
delete process.env.ELECTRON_RUN_AS_NODE
delete process.env.VSCODE_ESM_ENTRYPOINT

const packageDirectory = path.resolve(import.meta.dir, '..')
const outputDirectory = path.join(packageDirectory, '.extension-test')
const markerDirectory = await mkdtemp(
  path.join(tmpdir(), 'markscript-extension-host-'),
)
const markerPath = path.join(markerDirectory, 'run-result.txt')

try {
  await rm(outputDirectory, {recursive: true, force: true})
  await mkdir(outputDirectory, {recursive: true})
  const result = await Bun.build({
    entrypoints: [path.join(packageDirectory, 'test/extension-host.ts')],
    outdir: outputDirectory,
    target: 'node',
    format: 'cjs',
    packages: 'bundle',
    external: ['vscode'],
    naming: {entry: 'index.cjs'},
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error('Failed to build the extension-host test module')
  }

  const launchArgs = [
    path.join(packageDirectory, 'test-workspace'),
    '--disable-extensions',
    '--disable-gpu',
  ]

  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? 'stable',
    cachePath: path.join(packageDirectory, '.vscode-test'),
    extensionDevelopmentPath: packageDirectory,
    extensionTestsPath: path.join(outputDirectory, 'index.cjs'),
    launchArgs,
    extensionTestsEnv: {
      MARKSCRIPT_BUN: process.execPath,
      MARKSCRIPT_EXTENSION_TEST_MARKER: markerPath,
    },
  })

  const marker = await readFile(markerPath, 'utf8')
  if (marker !== 'ran') {
    throw new Error(`Run File wrote an unexpected marker: ${marker}`)
  }
} finally {
  await Promise.all([
    rm(outputDirectory, {recursive: true, force: true}),
    rm(markerDirectory, {recursive: true, force: true}),
  ])
}
