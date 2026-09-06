// @vitest-environment happy-dom

/* Iris finding 11: the nav merge deleted three Tasks-entry tests and replaced
 * them with nothing, leaving the sub-nav's central invariant asserted only by a
 * code comment.
 *
 * That invariant: switching sub-tabs must ONLY call setActiveView. The
 * Communications subtree is ~247k lines kept mounted-but-hidden in
 * AppWorkspaceShell so channels keep receiving while you are on another tab.
 * If someone later "tidies" the sub-nav into rendering its own children, that
 * tree gets re-parented and live channels die silently — no error, no failing
 * build, just messages that stop arriving. These tests fail loudly instead. */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const setActiveView = vi.fn()
let state: { activeView: string; settings: { experimentalActivity?: boolean } | null }

vi.mock('@/store', () => ({
  useAppStore: (selector: (s: unknown) => unknown) => selector({ ...state, setActiveView })
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { AgentsHubSubNav, isAgentsHubView } from './AgentsHubSubNav'

beforeEach(() => {
  cleanup()
  setActiveView.mockClear()
  state = { activeView: 'tasks', settings: { experimentalActivity: true } }
})

describe('isAgentsHubView', () => {
  it('claims every surface the one Agents entry owns', () => {
    for (const view of ['dashboard', 'tasks', 'buzz', 'activity', 'agents']) {
      expect(isAgentsHubView(view as never)).toBe(true)
    }
  })

  it('does not claim unrelated destinations', () => {
    for (const view of ['terminal', 'settings', 'skills', 'automations', 'mobile']) {
      expect(isAgentsHubView(view as never)).toBe(false)
    }
  })
})

describe('the mount invariant', () => {
  it('ONLY calls setActiveView when a tab is clicked', async () => {
    render(<AgentsHubSubNav />)
    await userEvent.click(screen.getByRole('tab', { name: /channels/i }))
    expect(setActiveView).toHaveBeenCalledTimes(1)
    expect(setActiveView).toHaveBeenCalledWith('buzz')
  })

  it('renders no page content of its own — only tabs', () => {
    // If this ever fails, someone gave the sub-nav children. That re-parents
    // the Communications subtree and kills live channels.
    const { container } = render(<AgentsHubSubNav />)
    const root = container.firstElementChild
    expect(root?.getAttribute('role')).toBe('tablist')
    for (const child of Array.from(root?.children ?? [])) {
      expect(child.getAttribute('role')).toBe('tab')
    }
  })
})

describe('the experimental Activity gate', () => {
  it('hides Activity when experimentalActivity is off', () => {
    state = { activeView: 'tasks', settings: { experimentalActivity: false } }
    render(<AgentsHubSubNav />)
    expect(screen.queryByRole('tab', { name: /activity/i })).toBeNull()
    expect(screen.getByRole('tab', { name: /board/i })).toBeTruthy()
  })

  it('shows Activity when the flag is on', () => {
    render(<AgentsHubSubNav />)
    expect(screen.getByRole('tab', { name: /activity/i })).toBeTruthy()
  })

  it('keeps Activity visible if it is the surface you are already on', () => {
    // Why: hiding the tab you are standing on would strand you with no way back.
    state = { activeView: 'activity', settings: { experimentalActivity: false } }
    render(<AgentsHubSubNav />)
    expect(screen.getByRole('tab', { name: /activity/i })).toBeTruthy()
  })
})

describe('Overview', () => {
  it('is the first tab and switches to the dashboard view', async () => {
    render(<AgentsHubSubNav />)
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs[0]).toMatch(/overview/i)
    await userEvent.click(screen.getByRole('tab', { name: /overview/i }))
    expect(setActiveView).toHaveBeenCalledWith('dashboard')
  })
})
