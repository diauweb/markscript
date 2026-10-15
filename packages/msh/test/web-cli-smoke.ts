import assert from 'node:assert/strict'
import {mkdtemp, readdir, rm} from 'node:fs/promises'
import path from 'node:path'
import {chromium, expect} from 'playwright/test'

const directory = await mkdtemp('/tmp/msh-web-cli-')
const child = Bun.spawn(
  [
    process.execPath,
    path.resolve(import.meta.dir, '../dist/cli.js'),
    'demo',
    '--web',
  ],
  {
    cwd: directory,
    env: {
      ...process.env,
      MSH_HOME: path.join(directory, 'home'),
      LANGSMITH_TRACING: 'false',
    },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  },
)
let stderr = ''
const output = new Response(child.stdout).text()
let resolveUrl!: (url: string) => void
let rejectUrl!: (reason: Error) => void
const url = new Promise<string>((resolve, reject) => {
  resolveUrl = resolve
  rejectUrl = reject
})
const timeout = setTimeout(
  () => rejectUrl(new Error('CLI did not print a local URL')),
  20000,
)
const read = (async () => {
  for await (const bytes of child.stderr) {
    stderr += new TextDecoder().decode(bytes)
    const match = stderr.match(
      /msh WebUI: (http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9-]+)/u,
    )
    if (match?.[1]) {
      clearTimeout(timeout)
      resolveUrl(match[1])
    }
  }
})()
const browser = await chromium.launch({
  executablePath:
    process.env.MSH_BROWSER ??
    Bun.which('chromium') ??
    chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  const address = await url
  await page.goto(address)
  await expect(page.getByText('42', {exact: true})).toBeVisible({
    timeout: 20000,
  })
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('/quit')
  await page.getByRole('textbox', {name: 'Message', exact: true}).press('Enter')
  await expect(
    page.getByRole('heading', {name: 'Session closed', exact: true}),
  ).toBeVisible()
  assert.equal(await child.exited, 0)
  await read
  assert.equal(await output, '')
  assert.equal((await readdir(path.join(directory, 'home/sessions'))).length, 1)
  console.log(
    'Packaged CLI WebUI passed outside the repository: local URL, browser assets, initialization, deterministic demo, saved history, clean stdout, and shutdown.',
  )
} finally {
  clearTimeout(timeout)
  child.kill()
  await child.exited
  await browser.close()
  await rm(directory, {recursive: true, force: true})
}
