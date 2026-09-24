import type * as FsModule from 'node:fs'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRegistry, DeviceRegistryUnreadableError } from './device-registry'
import { DEVICE_REGISTRY_FILENAME } from './mobile-pairing-files'

// Why: the registry is hardened (chmod 600) before it is read, so a real
// chmod 000 cannot produce EACCES; inject the read failure instead.
const fsHooks = vi.hoisted(() => ({ failReadWith: null as string | null }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (fsHooks.failReadWith) {
        throw Object.assign(new Error(`${fsHooks.failReadWith}: injected`), {
          code: fsHooks.failReadWith
        })
      }
      return actual.readFileSync(...args)
    }) as typeof actual.readFileSync
  }
})

const PAIRED = [
  {
    deviceId: 'phone-1',
    name: 'iPhone',
    token: 'paired-token',
    scope: 'mobile',
    pairedAt: 1,
    lastSeenAt: 2
  }
]

let dir = ''
let registryPath = ''

function snapshot(): { bytes: string; mtimeMs: number; entries: string[] } {
  const saved = fsHooks.failReadWith
  fsHooks.failReadWith = null
  const result = {
    bytes: readFileSync(registryPath, 'utf-8'),
    mtimeMs: statSync(registryPath).mtimeMs,
    entries: readdirSync(dir).sort()
  }
  fsHooks.failReadWith = saved
  return result
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dobius-device-registry-'))
  registryPath = join(dir, DEVICE_REGISTRY_FILENAME)
  fsHooks.failReadWith = null
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  fsHooks.failReadWith = null
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('DeviceRegistry with an unreadable file', () => {
  const cases: { name: string; bytes: string; failReadWith?: string }[] = [
    { name: 'corrupt JSON', bytes: JSON.stringify(PAIRED).slice(0, 40) },
    { name: 'wrong top-level shape', bytes: JSON.stringify({ devices: PAIRED }) },
    { name: 'entry without a token', bytes: JSON.stringify([{ deviceId: 'x', name: 'n' }]) },
    { name: 'EACCES on read', bytes: JSON.stringify(PAIRED), failReadWith: 'EACCES' }
  ]

  for (const testCase of cases) {
    it(`${testCase.name}: blocks every pairing mutation and never rewrites the file`, () => {
      writeFileSync(registryPath, testCase.bytes, { mode: 0o600 })
      const before = snapshot()
      fsHooks.failReadWith = testCase.failReadWith ?? null

      const registry = new DeviceRegistry(dir)

      expect(() => registry.addDevice('new phone')).toThrow(DeviceRegistryUnreadableError)
      expect(() => registry.getOrCreatePendingDevice('new phone')).toThrow(
        DeviceRegistryUnreadableError
      )
      expect(() => registry.rotatePendingDevice('new phone')).toThrow(
        DeviceRegistryUnreadableError
      )
      expect(() => registry.removeDevice('phone-1')).toThrow(DeviceRegistryUnreadableError)
      registry.updateLastSeen('phone-1')
      // Fail closed: nothing authenticates against a registry we cannot read.
      expect(registry.validateToken('paired-token')).toBeNull()
      expect(registry.listDevices()).toEqual([])

      expect(snapshot()).toEqual(before)
    })
  }

  it('recovers without a restart once the file is readable again, keeping existing devices', () => {
    writeFileSync(registryPath, '[{"deviceId":', { mode: 0o600 })
    const registry = new DeviceRegistry(dir)
    expect(() => registry.addDevice('new phone')).toThrow(DeviceRegistryUnreadableError)

    writeFileSync(registryPath, JSON.stringify(PAIRED), { mode: 0o600 })

    expect(registry.validateToken('paired-token')?.deviceId).toBe('phone-1')
    const added = registry.addDevice('new phone')
    const onDisk = JSON.parse(readFileSync(registryPath, 'utf-8')) as { deviceId: string }[]
    expect(onDisk.map((d) => d.deviceId)).toEqual(['phone-1', added.deviceId])
  })

  it('a missing file is a first run: pairing works and creates the file', () => {
    const registry = new DeviceRegistry(dir)

    const pending = registry.getOrCreatePendingDevice('phone')

    expect(registry.validateToken(pending.token)?.deviceId).toBe(pending.deviceId)
    expect(JSON.parse(readFileSync(registryPath, 'utf-8'))).toHaveLength(1)
  })

  it('legacy entries without scope still load as mobile', () => {
    writeFileSync(
      registryPath,
      JSON.stringify([{ deviceId: 'old', name: 'old', token: 't', pairedAt: 1, lastSeenAt: 1 }]),
      { mode: 0o600 }
    )

    expect(new DeviceRegistry(dir).getDevice('old')?.scope).toBe('mobile')
  })
})
