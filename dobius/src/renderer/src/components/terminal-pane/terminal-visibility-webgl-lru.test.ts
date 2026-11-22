/**
 * Memory-leak regression: tabs hidden inside the active worktree must not all
 * keep a live WebGL context.
 *
 * A tab switch kept the hidden tab's WebGL renderer (renderingSuspended:
 * false), so every tab ever viewed held a GPU context. Only the 4 most
 * recently hidden tabs stay live now; older ones are suspended and take the
 * heavy resume path (which resumes rendering) when shown again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import {
  MAX_LIVE_HIDDEN_TERMINAL_TABS,
  forgetTerminalVisibility,
  hideTerminalVisibility,
  liveHiddenTerminalTabCountForTest,
  resumeTerminalVisibility
} from './terminal-visibility-resume'

vi.mock('@/lib/pane-manager/pane-manager-registry', () => ({
  resetAndRefreshAllTerminalWebglAtlases: vi.fn()
}))
vi.mock('@/lib/pane-manager/pane-terminal-output-scheduler', () => ({
  flushTerminalOutput: vi.fn(),
  requestTerminalBacklogRecovery: vi.fn()
}))
vi.mock('@/lib/pane-manager/terminal-scroll-intent', () => ({
  enforceTerminalCurrentScrollIntent: vi.fn()
}))
vi.mock('./pane-helpers', () => ({
  fitAndFocusPanes: vi.fn(),
  fitPanes: vi.fn(),
  focusActivePane: vi.fn()
}))
vi.mock('./terminal-webgl-atlas-recovery', () => ({
  scheduleTerminalWebglAtlasRecovery: vi.fn()
}))

type FakeManager = {
  live: boolean
  getPanes: () => []
  suspendRendering: () => void
  resumeRendering: () => void
  scheduleRevealRepaint: () => void
}

function createManager(): FakeManager {
  const m: FakeManager = {
    live: true,
    getPanes: () => [],
    suspendRendering: () => {
      m.live = false
    },
    resumeRendering: () => {
      m.live = true
    },
    scheduleRevealRepaint: () => {}
  }
  return m
}

const asManager = (m: FakeManager): PaneManager => m as never as PaneManager

function hideTab(m: FakeManager): boolean {
  return hideTerminalVisibility({
    manager: asManager(m),
    wasVisible: true,
    wasWorktreeActive: true,
    isWorktreeActive: true,
    hasCompletedVisibleResume: true,
    captureViewportPositions: () => new Map()
  }).renderingSuspended
}

function showTab(m: FakeManager, lightRequested: boolean): void {
  resumeTerminalVisibility({
    manager: asManager(m),
    isActive: true,
    wasVisible: false,
    shouldUseLightTabResume: lightRequested,
    captureViewportPositions: () => new Map(),
    withSuppressedScrollTracking: (cb) => cb()
  })
}

describe('hidden-tab WebGL LRU', () => {
  const created: FakeManager[] = []
  beforeEach(() => {
    for (const m of created.splice(0)) {
      forgetTerminalVisibility(asManager(m))
    }
  })

  it('keeps at most 4 hidden tabs live across 10,000 tab switches', () => {
    const tabs = Array.from({ length: 50 }, () => createManager())
    created.push(...tabs)
    for (let i = 0; i < 10_000; i += 1) {
      const tab = tabs[i % tabs.length]
      // The caller passes light resume when its own hide did not suspend.
      showTab(tab, true)
      hideTab(tab)
    }
    expect(MAX_LIVE_HIDDEN_TERMINAL_TABS).toBe(4)
    expect(liveHiddenTerminalTabCountForTest()).toBeLessThanOrEqual(4)
    expect(tabs.filter((t) => t.live).length).toBeLessThanOrEqual(4)
  })

  it('suspends the least recently visible tab beyond the cap and resumes it when shown', () => {
    const tabs = Array.from({ length: MAX_LIVE_HIDDEN_TERMINAL_TABS + 1 }, () => createManager())
    created.push(...tabs)
    for (const tab of tabs) {
      expect(hideTab(tab)).toBe(false)
    }
    expect(tabs[0].live).toBe(false)
    expect(tabs.slice(1).every((t) => t.live)).toBe(true)

    // Its hide reported live, so the caller still asks for a light resume;
    // the LRU must force rendering back on anyway.
    showTab(tabs[0], true)
    expect(tabs[0].live).toBe(true)
  })

  it('leaves a recently hidden tab on the light path (no rendering churn)', () => {
    const tab = createManager()
    created.push(tab)
    hideTab(tab)
    const resume = vi.spyOn(tab, 'resumeRendering')
    showTab(tab, true)
    expect(resume).not.toHaveBeenCalled()
    expect(tab.live).toBe(true)
  })
})
