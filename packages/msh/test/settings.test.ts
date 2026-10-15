import {expect, test} from 'bun:test'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {ProfileStore, providerOptions, publicProfile} from '../src/settings.ts'

test('profile authentication distinguishes logged-out, environment and authless states', async () => {
  const directory = await mkdtemp('/tmp/msh-profiles-')
  const store = new ProfileStore(directory)
  const variable = `MSH_TEST_KEY_${crypto.randomUUID().replaceAll('-', '')}`
  const profile = {
    name: 'local',
    preset: 'custom' as const,
    baseURL: 'http://localhost:1234/v1',
    model: 'model',
    auth: {kind: 'env' as const, variable},
  }
  try {
    await store.save(profile)
    expect(() => providerOptions(profile)).toThrow(`Set ${variable}`)
    process.env[variable] = 'first-test-secret'
    expect(providerOptions(await store.get()).apiKey).toBe('first-test-secret')
    process.env[variable] = 'rotated-test-secret'
    expect(providerOptions(await store.get()).apiKey).toBe(
      'rotated-test-secret',
    )
    expect(await readFile(store.filename, 'utf8')).not.toContain('test-secret')
    expect(JSON.stringify(publicProfile(profile))).not.toContain('test-secret')
    await store.logout()
    expect(() => providerOptions({...profile, auth: null})).toThrow(
      'Login required',
    )
    await store.save({...profile, auth: {kind: 'none'}})
    expect(providerOptions(await store.get()).apiKey).toBeUndefined()
    const before = await readFile(store.filename, 'utf8')
    expect(() =>
      store.save({...profile, baseURL: 'https://user:password@example.com/v1'}),
    ).toThrow('without credentials')
    expect(await readFile(path.join(directory, 'config.json'), 'utf8')).toBe(
      before,
    )
  } finally {
    delete process.env[variable]
    await rm(directory, {recursive: true, force: true})
  }
})
