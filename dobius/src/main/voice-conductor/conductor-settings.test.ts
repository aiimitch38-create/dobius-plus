import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  asana: { myGid: 'build-1', reviewGid: 'review-1' },
  selfHandle: null as string | null
}))
vi.mock('../asana/asana-config', () => ({
  getAsanaConfig: () => ({ ...state.asana, allowedProjects: [], autoMode: {} })
}))
vi.mock('../imessage-bridge/bridge-config', () => ({
  getImessageBridgeConfig: () => ({ selfHandle: state.selfHandle })
}))

describe('#121 conductor lanes follow Settings', () => {
  it('classifies with the lane gids saved in Settings, re-read on every fetch', async () => {
    const { createSettingsLaneAsanaQueue } = await import('./conductor-settings')
    const listTasks = vi.fn(async () => [
      { gid: 'T1', name: 'a', assignee: { gid: 'build-1' } },
      { gid: 'T2', name: 'b', assignee: { gid: 'review-2' } },
      { gid: 'T3', name: 'c', assignee: { gid: '1215600517617968' } }
    ])
    const queue = createSettingsLaneAsanaQueue(undefined, listTasks)

    const before = await queue.fetch('proj')
    expect(before.tasks.map((t) => [t.gid, t.lane])).toEqual([['T1', 'build']])

    state.asana = { myGid: 'build-9', reviewGid: 'review-2' }
    const after = await queue.fetch('proj')
    expect(after.tasks.map((t) => [t.gid, t.lane])).toEqual([['T2', 'review']])
  })
})

describe('#10 conductor handle comes from the iMessage bridge setting', () => {
  it('returns the saved handle, or null when unset', async () => {
    const { conductorImessageHandle } = await import('./conductor-settings')
    expect(conductorImessageHandle()).toBeNull()
    state.selfHandle = '+15551234567'
    expect(conductorImessageHandle()).toBe('+15551234567')
  })
})
