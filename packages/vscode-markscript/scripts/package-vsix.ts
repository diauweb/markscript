import {cp, mkdtemp, readFile, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'

const packageDirectory = path.resolve(import.meta.dir, '..')
const manifest = JSON.parse(
  await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
) as {name: string; version: string}
const staging = await mkdtemp(path.join(tmpdir(), 'markscript-vscode-package-'))
const output = path.join(
  packageDirectory,
  `${manifest.name}-${manifest.version}.vsix`,
)
const entries = [
  '.vscodeignore',
  'LICENSE',
  'README.md',
  'dist',
  'language-configuration.json',
  'manuals',
  'package.json',
  'syntaxes',
] as const

try {
  await Promise.all(
    entries.map((entry) =>
      cp(path.join(packageDirectory, entry), path.join(staging, entry), {
        recursive: true,
      }),
    ),
  )
  const require = createRequire(import.meta.url)
  const vsceRoot = path.join(packageDirectory, 'node_modules/@vscode/vsce')
  const {createVSIX} = require(path.join(vsceRoot, 'out/api.js')) as {
    createVSIX(options: {
      cwd: string
      dependencies: boolean
      packagePath: string
    }): Promise<void>
  }
  await createVSIX({cwd: staging, dependencies: false, packagePath: output})
} finally {
  await rm(staging, {recursive: true, force: true})
}
