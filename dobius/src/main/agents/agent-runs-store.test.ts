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
