import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsanaConfig, AsanaTask } from '../../shared/asana'
import { DEFAULT_ASANA_CONFIG } from '../../shared/asana'

const mocks = vi.hoisted(() => ({
  fetchLane: vi.fn(),
  getAsanaConfig: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent-dobius-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('./asana-token-store', () => ({ hasAsanaToken: () => true }))
vi.mock('./asana-config', () => ({ getAsanaConfig: mocks.getAsanaConfig }))
vi.mock('./asana-client', () => ({ fetchLane: mocks.fetchLane, markTaskComplete: vi.fn() }))

function laneTask(gid: string, lane: AsanaTask['lane'], projectGids: string[]): AsanaTask {
  return {
    gid,
    name: gid,
    notes: '',
    url: '',
    dueOn: null,
    completed: lane === 'review',
    lane,
    assignee: null,
    projectGids
  }
}

beforeEach(() => {
  vi.resetModules()
  mocks.fetchLane.mockReset()
  mocks.fetchLane.mockImplementation(async (lane: AsanaTask['lane']) => [
    laneTask(lane === 'build' ? '900001' : '900002', lane, ['999000']),
    laneTask(lane === 'build' ? '900003' : '900004', lane, [])
  ])
})

describe('asana queue service snapshot', () => {
  it('is never filtered by allowedProjects (Auto Mode applies the allowlist)', async () => {
    const config: AsanaConfig = {
      ...DEFAULT_ASANA_CONFIG,
      allowedProjects: [{ name: 'Site', gid: '123123' }],
      autoMode: { ...DEFAULT_ASANA_CONFIG.autoMode }
    }
    mocks.getAsanaConfig.mockReturnValue(config)
    const { refreshAsanaTasks } = await import('./asana-queue-service')
    const snapshot = await refreshAsanaTasks()
    expect(snapshot.build.map((t) => t.gid)).toEqual(['900001', '900003'])
    expect(snapshot.review.map((t) => t.gid)).toEqual(['900002', '900004'])
    expect(snapshot.build[0].projectGids).toEqual(['999000'])
  })
})
