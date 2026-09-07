import assert from 'node:assert/strict'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import markscriptPlugin from '@markscript/compiler/prettier'
import {writeDocx} from '@markscript/docx'
import {bundleFile, checkFile, hasErrors, runFile} from '@markscript/markscript'
import {format} from 'prettier'

// Copy this script into a consumer directory containing installed tarballs or
// registry packages so module resolution exercises the published package graph.
const directory = import.meta.dirname
const filename = join(directory, 'document.ms')
const source = `import {onTransform} from '@markscript/markscript'

# Package test

::meta{title="Hello *world*"}

Hello {1+2}.

{onTransform(({root}) => { root.data = {...root.data, ready: true} })}
`
const formatted = await format(source, {
  filepath: filename,
  plugins: [markscriptPlugin],
})
assert.match(formatted, /title="Hello \*world\*"/u)
await Bun.write(filename, formatted)
const diagnostics = await checkFile(filename)
assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics))
const root = await runFile(filename)
assert.equal(root.data?.ready, true)
assert.equal(root.children[0]?.type, 'heading')

const bundled = await bundleFile(filename)
assert.equal(hasErrors(bundled.diagnostics), false)
const bundle = join(directory, 'document.mjs')
await Bun.write(bundle, bundled.code)
const entry = await import(pathToFileURL(bundle).href)
assert.deepEqual(await entry.default(), root)

const docx = join(directory, 'document.docx')
await writeDocx(root, docx)
assert.equal(await Bun.file(docx).slice(0, 2).text(), 'PK')

for (const args of [
  ['markscript', 'check', filename],
  ['markscript', 'help', 'ERR1104'],
  ['msdocs', 'build', filename, '--out-dir', join(directory, 'site')],
] as const) {
  const [command, ...rest] = args
  const child = Bun.spawn(
    [process.execPath, join(directory, 'node_modules/.bin', command), ...rest],
    {cwd: directory, stdout: 'pipe', stderr: 'pipe'},
  )
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  assert.equal(status, 0, `${command}: ${stderr}\n${stdout}`)
}
assert.match(
  await Bun.file(join(directory, 'site/index.html')).text(),
  /Package test/u,
)
console.log(
  'Installed packages passed: checking, formatting, execution, bundling, DOCX, manuals, and site generation.',
)
