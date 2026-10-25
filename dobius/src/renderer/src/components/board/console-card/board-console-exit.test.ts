import { describe, expect, it } from 'vitest'
import { boardConsolePtyExitOutcome } from './board-console-exit'

const state = {
  boardsByWorktree: {
    wt: {
      cards: [
        { id: 'c1', kind: 'console', tabId: 'tab-console', title: 'Hermes 1', x: 0, y: 0, z: 1 },
        { id: 'n1', kind: 'note', tabId: 'tab-note', title: 'Note', x: 0, y: 0, z: 1 }
      ],
      groups: []
    }
  }
} as never

describe('boardConsolePtyExitOutcome', () => {
  it('keeps the pane (tab stays, scrollback visible) when a Board console card owns the tab', () => {
    expect(boardConsolePtyExitOutcome(state, 'wt', 'tab-console')).toBe('keep-pane')
  })

  it('closes the tab as before for tabs no console card owns', () => {
    expect(boardConsolePtyExitOutcome(state, 'wt', 'tab-classic')).toBe('close-tab')
    expect(boardConsolePtyExitOutcome(state, 'wt', 'tab-note')).toBe('close-tab')
    expect(boardConsolePtyExitOutcome(state, 'other', 'tab-console')).toBe('close-tab')
  })
})
