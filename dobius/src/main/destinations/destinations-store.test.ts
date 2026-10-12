import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

async function loadStore() {
  vi.resetModules()
  return import('./destinations-store')
}

function storePath(): string {
  return join(userDataDir, 'destinations.json')
}

function fileMode(target: string): number {
  return statSync(target).mode & 0o777
}

// Why: POSIX modes only; Windows uses ACLs, and root ignores modes.
const posix = process.platform !== 'win32'

describe('destinations store file permissions (BUILD-009C)', () => {
  let previousUmask = 0

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'dobius-destinations-'))
    previousUmask = process.umask(0o022)
  })

  afterEach(() => {
    process.umask(previousUmask)
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it.runIf(posix)('writes destinations.json owner-only (0600)', async () => {
    const store = await loadStore()

    store.saveDestination({
      name: 'Alerts',
      type: 'telegram',
      config: { botToken: 'fake-bot-token', chatId: '1' }
    })

    expect(fileMode(storePath())).toBe(0o600)
  })

  it.runIf(posix)('restricts an existing 0644 file when the store loads', async () => {
    writeFileSync(
      storePath(),
      `${JSON.stringify([
        {
          id: 'd1',
          name: 'Mail',
          type: 'email',
          config: { smtpPassword: 'fake-password' },
          createdAt: 1,
          updatedAt: 1
        }
      ])}\n`,
      'utf-8'
    )
    chmodSync(storePath(), 0o644)
    const store = await loadStore()

    expect(store.listDestinations()).toHaveLength(1)
    expect(fileMode(storePath())).toBe(0o600)
  })
})
