import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir }
}))

function configFile(): string {
  return join(testState.dir, 'imessage-bridge.json')
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777
}

async function loadModule() {
  vi.resetModules()
  const secureFile = await import('../../shared/secure-file')
  secureFile.__resetSecureFileHardenedPathsForTests()
  return import('./bridge-config')
}

describe.skipIf(process.platform === 'win32')('iMessage bridge config permissions (#15)', () => {
  let previousUmask = 0

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-bridge-config-'))
    previousUmask = process.umask(0o022)
  })

  afterEach(() => {
    process.umask(previousUmask)
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('creates the config owner-only (0600) under a permissive umask', async () => {
    const bridgeConfig = await loadModule()

    bridgeConfig.updateImessageBridgeConfig({ selfHandle: 'fake@example.invalid' })

    expect(modeOf(configFile())).toBe(0o600)
  })

  it('restricts an existing world-readable config to 0600 when it is loaded', async () => {
    writeFileSync(configFile(), JSON.stringify({ enabled: true, selfHandle: 'fake@example.invalid' }))
    chmodSync(configFile(), 0o644)
    const bridgeConfig = await loadModule()

    expect(bridgeConfig.getImessageBridgeConfig().selfHandle).toBe('fake@example.invalid')
    expect(modeOf(configFile())).toBe(0o600)
  })
})
