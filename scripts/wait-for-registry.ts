import {resolve} from 'node:path'

const workspace = resolve(import.meta.dirname, '..')
const packages: {name: string; version: string}[] = []
for (const file of new Bun.Glob('packages/*/package.json').scanSync(
  workspace,
)) {
  const manifest = await Bun.file(resolve(workspace, file)).json()
  if (!manifest.private) packages.push(manifest)
}

const deadline = Date.now() + 20 * 60_000
let pending = packages
while (pending.length > 0) {
  const results = await Promise.all(
    pending.map(async (pkg) => {
      const response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,
        {
          headers: {
            accept: 'application/vnd.npm.install-v1+json',
            'cache-control': 'no-cache',
          },
          signal: AbortSignal.timeout(15_000),
        },
      )
      if (response.status === 404 || response.status >= 500) {
        await response.body?.cancel()
        return pkg
      }
      if (!response.ok) {
        throw new Error(`npm returned ${response.status} for ${pkg.name}`)
      }
      const metadata = await response.json()
      return metadata.versions?.[pkg.version] ? null : pkg
    }),
  )
  pending = results.filter((pkg) => pkg !== null)
  if (pending.length === 0) break
  if (Date.now() >= deadline) {
    throw new Error(
      `npm availability timed out: ${pending.map((pkg) => pkg.name).join(', ')}`,
    )
  }
  console.log(`Waiting for npm availability: ${pending.length} packages`)
  await Bun.sleep(30_000)
}
console.log(`All ${packages.length} release versions are available from npm`)
