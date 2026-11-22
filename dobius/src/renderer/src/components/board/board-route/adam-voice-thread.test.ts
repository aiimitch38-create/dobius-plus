// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { currentlyLookingAt } from './adam-voice-thread'

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => store.state } }))

describe('currentlyLookingAt', () => {
  it('names the project, workspace and folder on screen', () => {
    store.state = {
      activeWorktreeId: 'wt-1',
      repos: [{ id: 'repo-1', displayName: 'Pocket Cologne' }],
      getKnownWorktreeById: (id: string) =>
        id === 'wt-1'
          ? { repoId: 'repo-1', displayName: ' ', branch: 'refs/heads/checkout-fix', path: '/code/pc' }
          : undefined
    }
    expect(currentlyLookingAt()).toEqual({
      project: 'Pocket Cologne',
      workspace: 'checkout-fix',
      folder: '/code/pc'
    })
  })

  it('is unknown when no workspace is open', () => {
    store.state = { activeWorktreeId: null, getKnownWorktreeById: () => undefined }
    expect(currentlyLookingAt()).toBeNull()
  })
})
