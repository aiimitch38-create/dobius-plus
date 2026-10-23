import { describe, expect, it } from 'vitest'
import { boardWorkspaceTabs } from './board-workspace-tabs'

describe('boardWorkspaceTabs', () => {
  it('drops archived worktrees, orders by sortOrder and falls back to the branch name', () => {
    const tabs = boardWorkspaceTabs(
      [
        {
          id: 'b',
          displayName: '',
          branch: 'refs/heads/feature/x',
          isArchived: false,
          sortOrder: 2
        },
        { id: 'a', displayName: 'Main', branch: 'main', isArchived: false, sortOrder: 1 },
        { id: 'c', displayName: 'Old', branch: 'old', isArchived: true, sortOrder: 0 }
      ],
      { a: 2 }
    )
    expect(tabs).toEqual([
      { id: 'a', name: 'Main', count: 2 },
      { id: 'b', name: 'feature/x', count: 0 }
    ])
  })
})
