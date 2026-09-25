import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsanaConfig } from '../../shared/asana'
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

function config(allowedProjects: AsanaConfig['allowedProjects']): AsanaConfig {
  return {
    ...DEFAULT_ASANA_CONFIG,
    allowedProjects,
    autoMode: { ...DEFAULT_ASANA_CONFIG.autoMode }
  }
}

beforeEach(() => {
  vi.resetModules()
  mocks.fetchLane.mockReset()
  mocks.fetchLane.mockResolvedValue([])
})

describe('asana queue service allowedProjects', () => {
  it('passes the stored project gids to both lanes', async () => {
    mocks.getAsanaConfig.mockReturnValue(
      config([
        { name: 'Site', gid: '123123' },
        { name: 'App', gid: '456456' }
      ])
    )
    const { refreshAsanaTasks } = await import('./asana-queue-service')
    await refreshAsanaTasks()
    expect(mocks.fetchLane).toHaveBeenCalledWith('build', DEFAULT_ASANA_CONFIG.myGid, [
      '123123',
      '456456'
    ])
    expect(mocks.fetchLane).toHaveBeenCalledWith('review', DEFAULT_ASANA_CONFIG.reviewGid, [
      '123123',
      '456456'
    ])
  })

  it('an empty list means no project filter', async () => {
    mocks.getAsanaConfig.mockReturnValue(config([]))
    const { refreshAsanaTasks } = await import('./asana-queue-service')
    await refreshAsanaTasks()
    expect(mocks.fetchLane).toHaveBeenCalledWith('build', DEFAULT_ASANA_CONFIG.myGid, [])
    expect(mocks.fetchLane).toHaveBeenCalledWith('review', DEFAULT_ASANA_CONFIG.reviewGid, [])
  })
})
