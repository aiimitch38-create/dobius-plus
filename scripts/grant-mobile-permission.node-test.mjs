import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grantMobilePermission } from './grant-mobile-permission.mjs'

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'dobius-grant-'))
  const registryPath = join(directory, 'devices.json')
  const devices = [
    {
      deviceId: 'phone-one',
      name: 'My phone',
      scope: 'mobile',
      token: 'PRIVATE_TOKEN_SENTINEL',
      grants: ['terminal.send'],
      unknown: 7
    },
    {
      deviceId: 'phone-two',
      name: 'Other phone',
      scope: 'mobile',
      token: 'OTHER_TOKEN',
      grants: []
    }
  ]
  await writeFile(registryPath, JSON.stringify(devices), { mode: 0o600 })
  const logs = []
  const options = {
    registryPath,
    deviceId: 'phone-one',
    grant: 'screen.view',
    checkClosed: () => {},
    confirm: async () => true,
    print: (value) => logs.push(value)
  }
  try {
    await run({ directory, options, devices, logs })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
test('adds only one grant to the exact phone, preserves unknown fields and private backups, and is idempotent', async () =>
  fixture(async ({ directory, options, devices, logs }) => {
    assert.deepEqual(await grantMobilePermission(options), { changed: true })
    const saved = JSON.parse(await readFile(options.registryPath, 'utf8'))
    assert.deepEqual(saved, [
      { ...devices[0], grants: ['terminal.send', 'screen.view'] },
      devices[1]
    ])
    assert.equal((await stat(options.registryPath)).mode & 0o777, 0o600)
    assert.equal(logs.join('').includes('PRIVATE_TOKEN_SENTINEL'), false)
    const backup = (await readdir(directory)).find((name) => name.includes('backup'))
    assert.equal((await stat(join(directory, backup))).mode & 0o777, 0o600)
    assert.deepEqual(await grantMobilePermission(options), { changed: false })
  }))
test('dry run and rejected confirmation do not write', async () =>
  fixture(async ({ options }) => {
    const original = await readFile(options.registryPath, 'utf8')
    await grantMobilePermission({
      ...options,
      dryRun: true,
      confirm: async () => {
        throw new Error('must not ask')
      }
    })
    await grantMobilePermission({ ...options, confirm: async () => false })
    assert.equal(await readFile(options.registryPath, 'utf8'), original)
  }))
test('rejects non-phone IDs, unsupported grants and malformed schema', async () =>
  fixture(async ({ options }) => {
    await assert.rejects(grantMobilePermission({ ...options, deviceId: 'latest' }))
    await assert.rejects(grantMobilePermission({ ...options, grant: 'terminal.send' }))
    await writeFile(options.registryPath, '{}')
    await assert.rejects(grantMobilePermission(options))
  }))
test('refuses a running app before reading and again before mutation', async () =>
  fixture(async ({ options }) => {
    await assert.rejects(
      grantMobilePermission({
        ...options,
        checkClosed: () => {
          throw new Error('running')
        }
      }),
      /running/
    )
    const original = await readFile(options.registryPath, 'utf8')
    let calls = 0
    await assert.rejects(
      grantMobilePermission({
        ...options,
        checkClosed: () => {
          if (++calls === 3) {
            throw new Error('running')
          }
        }
      }),
      /running/
    )
    assert.equal(await readFile(options.registryPath, 'utf8'), original)
  }))
test('refuses a registry changed while confirming instead of overwriting it', async () =>
  fixture(async ({ options, devices }) => {
    await assert.rejects(
      grantMobilePermission({
        ...options,
        confirm: async () => {
          await writeFile(
            options.registryPath,
            JSON.stringify([...devices, { ...devices[1], deviceId: 'phone-three' }])
          )
          return true
        }
      }),
      /changed/
    )
    assert.equal(JSON.parse(await readFile(options.registryPath, 'utf8')).length, 3)
  }))
