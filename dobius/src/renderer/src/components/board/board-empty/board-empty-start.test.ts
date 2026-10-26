import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardAgentOption } from '../board-chrome/BoardAgentPicker'

const { updateSettingsMock } = vi.hoisted(() => ({ updateSettingsMock: vi.fn() }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ updateSettings: updateSettingsMock }) }
}))

import {
  boardEmptyStartMoreAgents,
  boardEmptyStartSelection,
  selectBoardEmptyStartAgent,
  shouldShowBoardEmptyStart,
  useBoardEmptyStartDismissed
} from './board-empty-start'

const AGENTS: BoardAgentOption[] = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'aider', label: 'Aider' }
]

describe('shouldShowBoardEmptyStart', () => {
  const base = { hydrated: true, worktreeId: 'wt-1', cardCount: 0, dismissed: false }

  it('shows for a hydrated, open, empty, undismissed board', () => {
    expect(shouldShowBoardEmptyStart(base)).toBe(true)
  })

  it('stays hidden while boards are still hydrating (no startup flash)', () => {
    expect(shouldShowBoardEmptyStart({ ...base, hydrated: false })).toBe(false)
  })

  it('hides as soon as any card exists', () => {
    expect(shouldShowBoardEmptyStart({ ...base, cardCount: 1 })).toBe(false)
  })

  it('hides without an active worktree and after dismiss', () => {
    expect(shouldShowBoardEmptyStart({ ...base, worktreeId: null })).toBe(false)
    expect(shouldShowBoardEmptyStart({ ...base, dismissed: true })).toBe(false)
  })
})

describe('boardEmptyStartSelection', () => {
  it('uses the default-agent setting when it is launchable', () => {
    expect(boardEmptyStartSelection('claude', AGENTS)).toBe('claude')
  })

  it('falls back to the first launchable agent for blank, null or an uninstalled default', () => {
    expect(boardEmptyStartSelection('blank', AGENTS)).toBe('codex')
    expect(boardEmptyStartSelection(null, AGENTS)).toBe('codex')
    expect(boardEmptyStartSelection('grok', AGENTS)).toBe('codex')
  })

  it('is null when nothing can be launched', () => {
    expect(boardEmptyStartSelection('claude', [])).toBeNull()
  })
})

describe('boardEmptyStartMoreAgents', () => {
  it('lists only launchable agents without a tile of their own', () => {
    expect(boardEmptyStartMoreAgents(AGENTS).map((a) => a.id)).toEqual(['aider'])
  })
})

describe('selectBoardEmptyStartAgent', () => {
  beforeEach(() => updateSettingsMock.mockReset())

  it('writes the same defaultTuiAgent setting as Settings > Agents', () => {
    selectBoardEmptyStartAgent('gemini')
    expect(updateSettingsMock).toHaveBeenCalledWith({ defaultTuiAgent: 'gemini' })
  })
})

describe('useBoardEmptyStartDismissed', () => {
  beforeEach(() => useBoardEmptyStartDismissed.setState({ dismissed: {} }))

  it('dismisses per board for the session', () => {
    useBoardEmptyStartDismissed.getState().dismiss('wt-1')
    expect(useBoardEmptyStartDismissed.getState().dismissed).toEqual({ 'wt-1': true })
    expect(useBoardEmptyStartDismissed.getState().dismissed['wt-2']).toBeUndefined()
  })
})
