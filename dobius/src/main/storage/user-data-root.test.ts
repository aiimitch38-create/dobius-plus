import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePairingOffer } from '../../shared/pairing'

// Mutable userData the electron mock resolves. Flipping it mid-test stands in
// for app.setName() changing how app.getPath('userData') resolves (bug #53).
const electronMock = vi.hoisted(() => ({
  userDataDir: '',
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronMock.userDataDir) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, fn)
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn()
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}))

// Startup profiles: `early` is what userData resolves to when index.ts calls
// initDataPath() (after configureDevUserDataPath), `late` what it could resolve
// to after app.setName(devInstanceIdentity.name).
const profiles = [
  { profile: 'packaged', early: 'dobius-plus', late: 'Dobius+' },
  { profile: 'dev', early: 'Dobius+-dev', late: 'Dobius+: stabilize/014' },
  { profile: 'remote/e2e override', early: 'e2e-profile-1', late: 'Dobius+' }
]

type StoreWrite = { store: string; fileName: string; run: () => Promise<void> }

const storeWrites: StoreWrite[] = [
  {
    store: 'agents-store',
    fileName: 'agents.json',
    run: async () => {
      ;(await import('../agents/agents-store')).createAgent({ name: 'New agent' })
    }
  },
  {
    store: 'agent-runs-store',
    fileName: 'agents-runs.json',
    run: async () => {
      ;(await import('../agents/agent-runs-store')).addStoredAgentRun({
        id: 'run-1',
        agentId: 'agent-1',
        prompt: 'p',
        startedAt: 1,
        status: 'running'
      })
    }
  },
  {
    store: 'agent-notification-store',
    fileName: 'agents-notifications.json',
    run: async () => {
      ;(await import('../agents/agent-notification-store')).appendAgentNotification({
        agentId: 'a',
        kind: 'run-finished',
        ok: true,
        text: 't'
      })
    }
  },
  {
    store: 'agent-briefing-store',
    fileName: 'agents-briefing.json',
    run: async () => {
      ;(await import('../agents/agent-briefing-store')).appendBriefingItem({
        agentId: 'a',
        urgency: 'digest',
        summary: 's'
      })
    }
  },
  {
    store: 'agent-draft-store',
    fileName: 'agent-drafts.json',
    run: async () => {
      ;(await import('../agents/agent-draft-store')).appendDraft({
        agentId: 'a',
        target: { kind: 'asana', gid: '1' },
        body: 'b'
      })
    }
  },
  {
    store: 'asana-dispatch-ledger',
    fileName: 'asana-dispatch-ledger.json',
    run: async () => {
      expect(
        (await import('../agents/asana-dispatch-ledger')).claimTask('1', 'build')
      ).not.toBeNull()
    }
  },
  {
    store: 'asana-config',
    fileName: 'asana-config.json',
    run: async () => {
      ;(await import('../asana/asana-config')).updateAsanaConfig({ myGid: '999' })
    }
  },
  {
    store: 'team-store',
    fileName: 'teams.json',
    run: async () => {
      ;(await import('../communications/team-store')).createTeam({ name: 'Team' })
    }
  }
]

let root: string

function useProfile(early: string, late: string): { earlyDir: string; lateDir: string } {
  const earlyDir = path.join(root, early)
  const lateDir = path.join(root, late)
  mkdirSync(earlyDir, { recursive: true })
  mkdirSync(lateDir, { recursive: true })
  electronMock.userDataDir = earlyDir
  return { earlyDir, lateDir }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'dobius-user-data-root-'))
  electronMock.handlers.clear()
  vi.resetModules()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe.each(profiles)('$profile profile keeps one userData root (#53)', ({ early, late }) => {
  it('resolves the same root before and after app.setName', async () => {
    const { earlyDir, lateDir } = useProfile(early, late)
    const persistence = await import('../persistence')
    const rootModule = await import('./user-data-root')
    persistence.initDataPath()
    expect(rootModule.getUserDataRoot()).toBe(earlyDir)

    electronMock.userDataDir = lateDir

    expect(rootModule.getUserDataRoot()).toBe(earlyDir)
    expect(persistence.getCanonicalUserDataPath()).toBe(earlyDir)
    // A second capture after the rename must not move the root.
    expect(rootModule.captureUserDataRoot()).toBe(earlyDir)
    expect(rootModule.reportUserDataRootDivergence()).toBe(lateDir)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it.each(storeWrites)('$store writes $fileName under the captured root', async (store) => {
    const { earlyDir, lateDir } = useProfile(early, late)
    ;(await import('./user-data-root')).captureUserDataRoot()
    electronMock.userDataDir = lateDir

    await store.run()

    expect(existsSync(path.join(earlyDir, store.fileName))).toBe(true)
    expect(readdirSync(lateDir)).toEqual([])
  })

  it('runtime environments IPC reads the captured root', async () => {
    const { earlyDir, lateDir } = useProfile(early, late)
    ;(await import('./user-data-root')).captureUserDataRoot()
    const environmentStore = await import('../../shared/runtime-environment-store')
    const pairingCode = encodePairingOffer({
      v: 2,
      endpoint: 'ws://127.0.0.1:6768',
      deviceToken: 'device-token',
      publicKeyB64: Buffer.from(new Uint8Array(32).fill(1)).toString('base64')
    })
    environmentStore.addEnvironmentFromPairingCode(earlyDir, { name: 'desk', pairingCode })
    electronMock.userDataDir = lateDir

    const { registerRuntimeEnvironmentHandlers } = await import('../ipc/runtime-environments')
    registerRuntimeEnvironmentHandlers({
      getSettings: () => ({ activeRuntimeEnvironmentId: null }),
      updateSettings: vi.fn()
    } as never)
    const list = electronMock.handlers.get('runtimeEnvironments:list')!

    expect(await list(null, undefined)).toMatchObject([{ name: 'desk' }])
    expect(readdirSync(lateDir)).toEqual([])
  })
})

describe('before capture', () => {
  it('follows the live path without pinning it', async () => {
    const { earlyDir, lateDir } = useProfile('pre-redirect', 'dobius-plus')
    const rootModule = await import('./user-data-root')
    expect(rootModule.getUserDataRoot()).toBe(earlyDir)
    expect(rootModule.reportUserDataRootDivergence()).toBeNull()

    // configureDevUserDataPath redirects userData before initDataPath runs.
    electronMock.userDataDir = lateDir
    expect(rootModule.captureUserDataRoot()).toBe(lateDir)
    expect(rootModule.getUserDataRoot()).toBe(lateDir)
  })

  it('reports nothing when the live path still matches', async () => {
    useProfile('dobius-plus', 'unused')
    const rootModule = await import('./user-data-root')
    rootModule.captureUserDataRoot()
    expect(rootModule.reportUserDataRootDivergence()).toBeNull()
    expect(console.warn).not.toHaveBeenCalled()
  })
})
