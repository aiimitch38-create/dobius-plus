// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type {
  ProviderRateLimits,
  RateLimitState,
  UsageProbeProgress
} from '../../../../../shared/rate-limit-types'
import { BoardUsagePanel } from './BoardUsagePanel'
import {
  applyUsageProbeProgress,
  resetUsageProbeProgressForTest
} from './usage/board-usage-progress'

type StoreShape = {
  rateLimits: RateLimitState
  settings: { boardUsageResetChime: boolean }
  activeWorktreeId: string | null
  claudeUsageScope: 'dobius' | 'all'
  codexUsageScope: 'dobius' | 'all'
  openCodeUsageScope: 'dobius' | 'all'
  refreshRateLimits: () => Promise<void>
  updateSettings: () => Promise<void>
}

const { refreshMock, getDailyMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(() => Promise.resolve()),
  getDailyMock: vi.fn(() => Promise.resolve([]))
}))

// Why: the hoisted mock factory runs while this module is still evaluating
// (the component import triggers it), so the store is handed over lazily.
const store = create<StoreShape>(() => ({
  rateLimits: {
    claude: null,
    codex: null,
    gemini: null,
    opencodeGo: null,
    kimi: null,
    minimax: null,
    minimaxCookieConfigured: false,
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'host', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: []
  },
  settings: { boardUsageResetChime: false },
  activeWorktreeId: 'wt-1',
  claudeUsageScope: 'dobius',
  codexUsageScope: 'dobius',
  openCodeUsageScope: 'dobius',
  refreshRateLimits: refreshMock,
  updateSettings: () => Promise.resolve()
}))

vi.mock('@/store', () => ({
  get useAppStore() {
    return store
  }
}))
vi.mock('@/components/stats/UsageOverviewPane', () => ({
  UsageOverviewPane: () => <div data-testid="usage-overview-pane" />
}))

const SESSION = {
  usedPercent: 3,
  windowMinutes: 300,
  resetsAt: null,
  resetDescription: '2:20 AM'
}
const WEEKLY = { usedPercent: 17, windowMinutes: 10080, resetsAt: null, resetDescription: 'Sat' }

function claude(partial: Partial<ProviderRateLimits>): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: null,
    status: 'fetching',
    ...partial
  }
}

function setClaude(partial: Partial<ProviderRateLimits> | null): void {
  act(() => {
    store.setState((s) => ({
      rateLimits: { ...s.rateLimits, claude: partial === null ? null : claude(partial) }
    }))
  })
}

function renderPanel(): void {
  render(<BoardUsagePanel open onOpenChange={() => {}} anchor={<button>pill</button>} />)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetUsageProbeProgressForTest()
  refreshMock.mockClear()
  getDailyMock.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      rateLimits: { onProgress: () => () => {} },
      notifications: { playSound: () => Promise.resolve({ played: true }) },
      claudeUsage: { getDaily: getDailyMock },
      codexUsage: { getDaily: getDailyMock },
      openCodeUsage: { getDaily: getDailyMock }
    }
  })
  setClaude({ status: 'fetching' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('BoardUsagePanel', () => {
  it('shows the loading view with a live stage and elapsed timer, then the loaded view', () => {
    renderPanel()
    expect(screen.getByTestId('board-usage-loading')).toBeTruthy()
    expect(screen.getByTestId('board-usage-stage').textContent).toBe('Reading usage')
    expect(screen.getByTestId('board-usage-status').textContent).toBe('Reading usage')
    expect(screen.getByTestId('board-usage-refresh-busy')).toBeTruthy()

    act(() => {
      applyUsageProbeProgress({ provider: 'claude', stage: 'cli-usage', at: Date.now() })
    })
    expect(screen.getByTestId('board-usage-stage').textContent).toBe('Asking the CLI for /usage')
    expect(screen.getByText(/same page the CLI prints/)).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(screen.getByTestId('board-usage-elapsed').textContent).toBe('0:08')

    setClaude({ status: 'ok', session: SESSION, weekly: WEEKLY })
    expect(screen.queryByTestId('board-usage-loading')).toBeNull()
    expect(screen.getByTestId('board-usage-loaded')).toBeTruthy()
    expect(screen.getByTestId('board-usage-donut-percent').textContent).toBe('3%')
    expect(screen.getByTestId('board-usage-window-weekly').textContent).toContain('17%')
    expect(screen.getByTestId('board-usage-status').textContent).toBe(
      'your subscription · updated just now'
    )
    expect(screen.queryByTestId('board-usage-refresh-busy')).toBeNull()
  })

  it('keeps the loaded view and appends "refreshing" while a refresh is in flight', () => {
    setClaude({ status: 'ok', session: SESSION, updatedAt: Date.now() - 3 * 60_000 })
    renderPanel()
    expect(screen.getByTestId('board-usage-status').textContent).toBe(
      'your subscription · updated 3m ago'
    )

    fireEvent.click(screen.getByTestId('board-usage-refresh'))
    expect(refreshMock).toHaveBeenCalledTimes(1)
    setClaude({ status: 'fetching', session: SESSION, updatedAt: Date.now() - 3 * 60_000 })
    expect(screen.getByTestId('board-usage-loaded')).toBeTruthy()
    expect(screen.queryByTestId('board-usage-loading')).toBeNull()
    expect(screen.getByTestId('board-usage-status').textContent).toBe(
      'your subscription · updated 3m ago · refreshing'
    )
    expect(screen.getByTestId('board-usage-refresh-busy')).toBeTruthy()
  })

  it('shows the provider message when usage is unavailable', () => {
    setClaude({ status: 'error', error: 'Gemini CLI OAuth is disabled in settings' })
    renderPanel()
    expect(screen.getByTestId('board-usage-unavailable').textContent).toContain(
      'Gemini CLI OAuth is disabled in settings'
    )
    expect(screen.getByTestId('board-usage-status').textContent).toBe('no reading')
  })

  it('switches between the terminal, stats and usage views', () => {
    setClaude({ status: 'ok', session: SESSION, cliOutput: 'Current session\n3% used' })
    renderPanel()
    fireEvent.click(screen.getByTestId('board-usage-view-terminal'))
    expect(screen.getByTestId('board-usage-terminal').textContent).toContain('3% used')
    fireEvent.click(screen.getByTestId('board-usage-view-stats'))
    expect(screen.getByTestId('board-usage-stats')).toBeTruthy()
    expect(screen.queryByTestId('board-usage-terminal')).toBeNull()
    fireEvent.click(screen.getByTestId('board-usage-view-stats'))
    expect(screen.getByTestId('board-usage-loaded')).toBeTruthy()
  })

  it('asks once on open only when no provider has reported anything', () => {
    setClaude(null)
    renderPanel()
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('does not refetch on open when a reading exists', () => {
    setClaude({ status: 'ok', session: SESSION })
    renderPanel()
    expect(refreshMock).not.toHaveBeenCalled()
  })
})

// Keeps the progress type in use so a shape change here fails loudly.
const _progressShape: UsageProbeProgress = { provider: 'claude', stage: 'oauth', at: 0 }
void _progressShape
