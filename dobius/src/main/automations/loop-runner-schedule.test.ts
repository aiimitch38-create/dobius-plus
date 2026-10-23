import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as ExecutionGateModule from '../agents/execution-gate'
import { LOOP_PLACEHOLDER_RRULE, newLoopState } from '../../shared/automation-loops'
import { LoopRunner } from './loop-runner'
import type { LoopDeliveryStatus, LoopTerminals } from './loop-terminals'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('../agents/execution-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionGateModule>()
  return { ...actual, checkExecutionAdmission: () => ({ allowed: true }) }
})

const EVERY = 10 * 60_000

async function setup() {
  vi.resetModules()
  const { Store, initDataPath } = await import('../persistence')
  initDataPath()
  const store = new Store()
  store.addRepo({ id: 'r1', path: '/repo', displayName: 'test', badgeColor: '#fff', addedAt: 1 })
  const created = store.createAutomation({
    name: 'Progress',
    prompt: 'One-line status',
    agentId: 'claude',
    projectId: 'r1',
    workspaceMode: 'existing',
    workspaceId: 'wt1',
    timezone: 'UTC',
    rrule: LOOP_PLACEHOLDER_RRULE,
    dtstart: 0
  })
  const automation = store.updateAutomation(created.id, {
    loop: {
      worktreeId: 'wt1',
      trigger: { kind: 'schedule', target: { type: 'board' }, everyMs: EVERY },
      state: newLoopState()
    }
  })
  store.updateUI({
    boardsByWorktree: {
      wt1: {
        cards: [
          { id: 'c1', kind: 'console', tabId: 'tab-1' },
          { id: 'c2', kind: 'console', tabId: 'tab-2' }
        ],
        groups: []
      }
    }
  })
  const sent: string[] = []
  const reply: { status: LoopDeliveryStatus } = { status: 'sent' }
  const terminals: LoopTerminals = {
    read: async () => ({ lines: [], cursor: '0' }),
    deliver: async (tabId) => {
      if (reply.status === 'sent') {
        sent.push(tabId)
      }
      return reply.status
    }
  }
  const notify = vi.fn()
  const runner = new LoopRunner(store, terminals, notify)
  const loopOf = () => store.listAutomations().find((a) => a.id === automation.id)!
  return { store, runner, loopOf, sent, reply, notify, createdAt: automation.createdAt }
}

describe('schedule loops', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-loop-schedule-test-'))
  })
  afterEach(() => rmSync(testState.dir, { recursive: true, force: true }))

  it('fires an interval after creation to every console on the board, then waits again', async () => {
    const { runner, loopOf, sent, createdAt } = await setup()
    await runner.tick(createdAt + EVERY - 1)
    expect(sent).toEqual([])
    await runner.tick(createdAt + EVERY)
    expect(sent).toEqual(['tab-1', 'tab-2'])
    await runner.tick(createdAt + EVERY + 60_000)
    expect(sent).toHaveLength(2)
    expect(loopOf().loop?.state).toMatchObject({ runCount: 1, lastFiredAt: createdAt + EVERY })
  })

  it('holds on a permission prompt: notifies once and retries in 30s, then resumes', async () => {
    const { runner, loopOf, sent, reply, notify, createdAt } = await setup()
    reply.status = 'permission'
    const t1 = createdAt + EVERY
    await runner.tick(t1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Progress')
    expect(loopOf().loop?.state.lastResult).toMatch(/^Held/)
    await runner.tick(t1 + 29_000)
    await runner.tick(t1 + 30_000)
    expect(notify).toHaveBeenCalledTimes(1)
    reply.status = 'sent'
    await runner.tick(t1 + 60_000)
    expect(sent).toEqual(['tab-1', 'tab-2'])
    expect(loopOf().loop?.state.runCount).toBe(1)
  })

  it('retires when its time limit runs out and sends nothing more', async () => {
    const { store, runner, loopOf, sent, createdAt } = await setup()
    const automation = loopOf()
    store.updateAutomation(automation.id, { loop: { ...automation.loop!, stopAfterMs: EVERY } })
    await runner.tick(createdAt + EVERY)
    expect(sent).toEqual([])
    expect(loopOf().loop?.state).toMatchObject({ retiredAt: createdAt + EVERY })
    expect(loopOf().loop?.state.lastResult).toMatch(/Time limit/)
    expect(await runner.fireFromRequest(loopOf(), createdAt + EVERY + 1)).toBeNull()
  })
})
