import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ root: '' }))

vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => mocks.root }))

beforeEach(() => {
  mocks.root = mkdtempSync(path.join(tmpdir(), 'agent-runs-store-'))
  vi.resetModules()
})

afterEach(() => {
  rmSync(mocks.root, { recursive: true, force: true })
})

describe('agent-runs-store permission denials', () => {
  it('keeps recorded denials across a restart and drops malformed entries', async () => {
    writeFileSync(
      path.join(mocks.root, 'agents-runs.json'),
      JSON.stringify([
        {
          id: 'r1',
          agentId: 'a1',
          prompt: 'go',
          startedAt: 1,
          endedAt: 2,
          status: 'success',
          summary: 'done',
          permissionDenials: [
            { toolName: 'Bash', toolUseId: 't1', reason: 'denied', at: 5 },
            { toolName: 42, reason: 'bad' },
            'junk'
          ]
        }
      ])
    )
    const { getStoredAgentRun, updateStoredAgentRun } = await import('./agent-runs-store')
    expect(getStoredAgentRun('r1')?.permissionDenials).toEqual([
      { toolName: 'Bash', toolUseId: 't1', reason: 'denied', at: 5 }
    ])
    updateStoredAgentRun('r1', {
      permissionDenials: [{ toolName: 'Write', reason: 'no approver', at: 9 }]
    })
    const saved = JSON.parse(readFileSync(path.join(mocks.root, 'agents-runs.json'), 'utf8'))
    expect(saved[0].permissionDenials).toEqual([{ toolName: 'Write', reason: 'no approver', at: 9 }])

    vi.resetModules()
    const reloaded = await import('./agent-runs-store')
    expect(reloaded.getStoredAgentRun('r1')?.permissionDenials).toEqual([
      { toolName: 'Write', reason: 'no approver', at: 9 }
    ])
  })
})

function run(id: string, status: 'running' | 'success', startedAt: number) {
  return { id, agentId: 'a1', prompt: 'go', startedAt, status } as const
}

describe('agent-runs-store history cap (#42)', () => {
  it('keeps older running runs past the 50-run cap so they still get their completion', async () => {
    const store = await import('./agent-runs-store')
    store.addStoredAgentRun(run('live-1', 'running', 1))
    store.addStoredAgentRun(run('live-2', 'running', 2))
    for (let i = 0; i < 60; i += 1) {
      store.addStoredAgentRun(run(`done-${i}`, 'success', 10 + i))
    }
    const ids = store.listStoredAgentRuns().map((entry) => entry.id)
    expect(ids).toHaveLength(50)
    expect(ids.slice(0, 2)).toEqual(['live-1', 'live-2'])
    expect(ids.at(-1)).toBe('done-59')
    expect(ids).not.toContain('done-11')

    expect(store.updateStoredAgentRun('live-1', { status: 'success', endedAt: 99 })).toMatchObject({
      id: 'live-1',
      status: 'success'
    })
    expect(store.updateStoredAgentRun('live-2', { status: 'cancelled' })?.status).toBe('cancelled')
    expect(
      store.appendAgentRunOutbox('live-2', { id: 'o1', content: 'hi', createdAt: 1 })
    ).toBe(true)
  })

  it('never evicts a running run even when more than 50 are live', async () => {
    const store = await import('./agent-runs-store')
    for (let i = 0; i < 55; i += 1) {
      store.addStoredAgentRun(run(`live-${i}`, 'running', 1 + i))
    }
    expect(store.listStoredAgentRuns()).toHaveLength(55)
    store.updateStoredAgentRun('live-0', { status: 'success' })
    store.addStoredAgentRun(run('next', 'running', 100))
    const ids = store.listStoredAgentRuns().map((entry) => entry.id)
    expect(ids).not.toContain('live-0')
    expect(ids).toContain('live-1')
    expect(ids).toHaveLength(55)
  })
})

describe('agent-runs-store outbox byte budget (#77)', () => {
  const screenshot = (id: string, bytes: number) => ({
    id,
    content: 'shot',
    imageDataUrl: `data:image/png;base64,${'A'.repeat(bytes)}`,
    createdAt: 1
  })
  const outboxBytes = (items: { content: string; imageDataUrl?: string }[]) =>
    items.reduce((sum, item) => sum + item.content.length + (item.imageDataUrl?.length ?? 0), 0)

  it('keeps one run under its byte budget, dropping the oldest items first', async () => {
    const store = await import('./agent-runs-store')
    store.addStoredAgentRun(run('r1', 'running', 1))
    for (let i = 0; i < 30; i += 1) {
      expect(store.appendAgentRunOutbox('r1', screenshot(`s${i}`, 950_000))).toBe(true)
    }
    const items = store.getAgentRunOutbox('r1')
    expect(outboxBytes(items)).toBeLessThanOrEqual(store.MAX_OUTBOX_BYTES_PER_RUN)
    expect(items.at(-1)?.id).toBe('s29')
    expect(items.map((item) => item.id)).not.toContain('s0')
    // A reader whose cursor was trimmed away gets everything still queued.
    expect(store.getAgentRunOutbox('r1', 's0').map((item) => item.id)).toEqual(
      items.map((item) => item.id)
    )
    expect(store.getStoredAgentRun('r1')?.status).toBe('running')
  })

  it('rejects a single item larger than the per-run budget', async () => {
    const store = await import('./agent-runs-store')
    store.addStoredAgentRun(run('r1', 'running', 1))
    expect(
      store.appendAgentRunOutbox('r1', screenshot('huge', store.MAX_OUTBOX_BYTES_PER_RUN + 1))
    ).toBe(false)
    expect(store.getAgentRunOutbox('r1')).toEqual([])
  })

  it('keeps all runs together under the total budget, evicting the least recently written run', async () => {
    const store = await import('./agent-runs-store')
    for (let r = 0; r < 6; r += 1) {
      store.addStoredAgentRun(run(`r${r}`, 'running', 1 + r))
      for (let i = 0; i < 7; i += 1) {
        store.appendAgentRunOutbox(`r${r}`, screenshot(`r${r}-s${i}`, 950_000))
      }
    }
    let total = 0
    for (let r = 0; r < 6; r += 1) {
      total += outboxBytes(store.getAgentRunOutbox(`r${r}`))
    }
    expect(total).toBeLessThanOrEqual(store.MAX_OUTBOX_BYTES_TOTAL)
    expect(store.getAgentRunOutbox('r0')).toEqual([])
    expect(store.getAgentRunOutbox('r5')).toHaveLength(7)
  })
})
