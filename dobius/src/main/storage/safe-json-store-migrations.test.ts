import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronMock.userDataDir) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

const BAD_BYTES = '[{"id": "truncated", "na'

type StoreCase = {
  store: string
  fileName: string
  run: () => Promise<void>
}

// Each case loads the store, then attempts every kind of save it offers.
const storeCases: StoreCase[] = [
  {
    store: 'agents-store',
    fileName: 'agents.json',
    run: async () => {
      const store = await import('../agents/agents-store')
      expect(store.listAgents()).toEqual([])
      store.createAgent({ name: 'New agent' })
    }
  },
  {
    store: 'agent-runs-store',
    fileName: 'agents-runs.json',
    run: async () => {
      const store = await import('../agents/agent-runs-store')
      expect(store.listStoredAgentRuns()).toEqual([])
      store.addStoredAgentRun({
        id: 'run-1',
        agentId: 'agent-1',
        prompt: 'p',
        startedAt: 1,
        status: 'running'
      })
      store.updateStoredAgentRun('run-1', { status: 'success' })
    }
  },
  {
    store: 'agent-notification-store',
    fileName: 'agents-notifications.json',
    run: async () => {
      const store = await import('../agents/agent-notification-store')
      expect(store.listAgentNotifications().entries).toEqual([])
      store.appendAgentNotification({ agentId: 'a', kind: 'run-finished', ok: true, text: 't' })
      store.markAgentNotificationsRead()
    }
  },
  {
    store: 'agent-briefing-store',
    fileName: 'agents-briefing.json',
    run: async () => {
      const store = await import('../agents/agent-briefing-store')
      expect(store.listRecentBriefingItems()).toEqual([])
      store.appendBriefingItem({ agentId: 'a', urgency: 'digest', summary: 's' })
      store.dismissBriefingItems()
    }
  },
  {
    store: 'agent-draft-store',
    fileName: 'agent-drafts.json',
    run: async () => {
      const store = await import('../agents/agent-draft-store')
      expect(store.listDrafts()).toEqual([])
      const draft = store.appendDraft({
        agentId: 'a',
        target: { kind: 'asana', gid: '1' },
        body: 'b'
      })
      store.setDraftStatus(draft.id, 'approved')
    }
  },
  {
    store: 'asana-dispatch-ledger',
    fileName: 'asana-dispatch-ledger.json',
    run: async () => {
      const store = await import('../agents/asana-dispatch-ledger')
      expect(store.listDispatchRecords()).toEqual([])
      // Fail closed: the unreadable ledger may already hold this claim.
      expect(store.claimTask('123', 'build')).toBeNull()
      store.releaseClaim('123')
      store.pruneOld()
    }
  },
  {
    store: 'asana-config',
    fileName: 'asana-config.json',
    run: async () => {
      const store = await import('../asana/asana-config')
      expect(store.getAsanaConfig().autoMode.enabled).toBe(false)
      store.updateAsanaConfig({ myGid: '999' })
    }
  },
  {
    store: 'team-store',
    fileName: 'teams.json',
    run: async () => {
      const store = await import('../communications/team-store')
      expect(store.listTeams()).toEqual([])
      store.createTeam({ name: 'Team' })
    }
  }
]

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-store-migrations-'))
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('migrated stores never overwrite an unreadable file', () => {
  it.each(storeCases)('$store ($fileName)', async ({ fileName, run }) => {
    const target = path.join(electronMock.userDataDir, fileName)
    writeFileSync(target, BAD_BYTES, 'utf-8')
    const before = statSync(target)

    await run()

    expect(readFileSync(target, 'utf-8')).toBe(BAD_BYTES)
    expect(statSync(target).mtimeMs).toBe(before.mtimeMs)
    const names = readdirSync(electronMock.userDataDir)
    expect(names.filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(names.filter((name) => name.startsWith(`${fileName}.unreadable-`))).toHaveLength(1)
  })
})

describe('agent-runs-store restart reconciliation', () => {
  it('still converts interrupted runs after a successful parse', async () => {
    const target = path.join(electronMock.userDataDir, 'agents-runs.json')
    writeFileSync(
      target,
      JSON.stringify([{ id: 'r', agentId: 'a', prompt: 'p', startedAt: 5, status: 'running' }]),
      'utf-8'
    )
    const store = await import('../agents/agent-runs-store')

    expect(store.listStoredAgentRuns()[0]).toMatchObject({
      status: 'error',
      summary: 'app restarted during run'
    })
    expect(JSON.parse(readFileSync(target, 'utf-8'))[0]).toMatchObject({ status: 'error' })
  })

  it('writes nothing on first launch without a file', async () => {
    const store = await import('../agents/agent-runs-store')
    expect(store.listStoredAgentRuns()).toEqual([])
    expect(readdirSync(electronMock.userDataDir)).toEqual([])
  })
})

describe('agent-briefing-store dismiss (#46)', () => {
  it('hides the 48 h view without deleting older history', async () => {
    const target = path.join(electronMock.userDataDir, 'agents-briefing.json')
    const now = Date.now()
    const old = {
      id: 'old',
      agentId: 'a',
      ts: now - 5 * 24 * 60 * 60 * 1000,
      urgency: 'digest',
      summary: 'old'
    }
    const recent = {
      id: 'recent',
      agentId: 'a',
      ts: now - 60_000,
      urgency: 'now',
      summary: 'recent'
    }
    writeFileSync(target, JSON.stringify([old, recent]), 'utf-8')
    const store = await import('../agents/agent-briefing-store')
    expect(store.listRecentBriefingItems().map((item) => item.id)).toEqual(['recent'])

    store.dismissBriefingItems()

    expect(store.listRecentBriefingItems()).toEqual([])
    const saved = JSON.parse(readFileSync(target, 'utf-8')) as { id: string }[]
    expect(saved.map((item) => item.id)).toEqual(['old', 'recent'])

    const fresh = store.appendBriefingItem({ agentId: 'a', urgency: 'digest', summary: 'new' })
    expect(store.listRecentBriefingItems()).toEqual([fresh])

    vi.resetModules()
    const reloaded = await import('../agents/agent-briefing-store')
    expect(reloaded.listRecentBriefingItems().map((item) => item.id)).toEqual([fresh.id])
  })
})
