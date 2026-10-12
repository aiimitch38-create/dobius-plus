import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ root: '' }))

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => mocks.root) } }))
vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => mocks.root }))

beforeEach(() => {
  mocks.root = mkdtempSync(path.join(tmpdir(), 'agents-store-reset-'))
  vi.resetModules()
})

afterEach(() => {
  rmSync(mocks.root, { recursive: true, force: true })
})

async function seededAgent() {
  const store = await import('./agents-store')
  const lease = await import('./agent-session-lease')
  const [created] = store.createAgent({ name: 'Atlas' })
  const id = created.id
  store.updateAgentSession(id, { lastSessionId: 's-default', lastSessionCwd: '/repo' })
  store.updateAgentSession(id, {
    lastSessionId: 's-chan',
    lastSessionCwd: '/repo',
    sessionKey: 'chan-1'
  })
  store.updateAgentSession(id, {
    lastSessionId: 's-other',
    lastSessionCwd: '/repo',
    sessionKey: 'chan-2'
  })
  return { store, lease, id }
}

describe('resetAgentSession (#57)', () => {
  it('clears the default key, legacy fields and every channel key', async () => {
    const { store, id } = await seededAgent()
    store.resetAgentSession(id)
    const agent = store.getAgent(id)
    expect(agent?.lastSessionId).toBeUndefined()
    expect(agent?.lastSessionCwd).toBeUndefined()
    expect(agent?.sessionsByKey).toBeUndefined()
    if (!agent) {
      throw new Error('agent missing')
    }
    expect(store.getAgentSessionForKey(agent, 'default')).toBeNull()
    expect(store.getAgentSessionForKey(agent, 'chan-1')).toBeNull()
  })

  it('persists the reset across a reload', async () => {
    const { store, id } = await seededAgent()
    store.resetAgentSession(id)
    vi.resetModules()
    const reloaded = await import('./agents-store')
    const agent = reloaded.getAgent(id)
    if (!agent) {
      throw new Error('agent missing')
    }
    expect(reloaded.getAgentSessionForKey(agent, 'default')).toBeNull()
    expect(reloaded.getAgentSessionForKey(agent, 'chan-1')).toBeNull()
  })

  it('resets one named key and leaves the others', async () => {
    const { store, id } = await seededAgent()
    store.resetAgentSession(id, 'chan-1')
    const agent = store.getAgent(id)
    if (!agent) {
      throw new Error('agent missing')
    }
    expect(store.getAgentSessionForKey(agent, 'chan-1')).toBeNull()
    expect(store.getAgentSessionForKey(agent, 'chan-2')?.sessionId).toBe('s-other')
    expect(store.getAgentSessionForKey(agent, 'default')?.sessionId).toBe('s-default')
  })

  it('stops a run already in flight from recording its session over the reset', async () => {
    const { store, lease, id } = await seededAgent()
    lease.claimRunSession('run-before', id, 'chan-1')
    lease.claimRunSession('run-other-key', id, 'chan-2')
    store.resetAgentSession(id, 'chan-1')
    expect(lease.currentRunSessionKey('run-before')).toBeNull()
    lease.releaseRunSession('run-before')
    lease.claimRunSession('run-after', id, 'chan-1')
    expect(lease.currentRunSessionKey('run-other-key')).toBe('chan-2')
    expect(lease.currentRunSessionKey('run-after')).toBe('chan-1')

    store.resetAgentSession(id)
    expect(lease.currentRunSessionKey('run-other-key')).toBeNull()
    expect(lease.currentRunSessionKey('run-after')).toBeNull()
  })
})
