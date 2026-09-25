import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../shared/types'
import { shouldMountUpdateCardForStatus } from '@/lib/should-mount-update-card'

const { storeState } = vi.hoisted(() => ({
  storeState: {
    updateStatus: { state: 'idle' } as UpdateStatus,
    updateChangelog: null,
    updateUserInitiatedCycle: false,
    dismissedUpdateVersion: null,
    dismissUpdate: () => {},
    updateCardCollapsed: false,
    setUpdateCardCollapsed: () => {},
    updateReassuranceSeen: false,
    markUpdateReassuranceSeen: () => {},
    settingsSearchQuery: ''
  }
}))

vi.mock('../store', () => ({
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
}))

const { UpdateCard } = await import('./UpdateCard')
const { GeneralUpdateSettingsSection } = await import('./settings/GeneralUpdateSettingsSection')

const OFF_TEXT = 'Updates are managed by the install script.'
const UP_TO_DATE = /latest version/i

const DISABLED: Extract<UpdateStatus, { state: 'disabled' }>[] = [
  { state: 'disabled', reason: 'disconnected' },
  { state: 'disabled', reason: 'not-enabled' },
  { state: 'disabled', reason: 'dev-build' }
]

beforeEach(() => {
  vi.stubGlobal('window', {
    api: { shell: { openUrl: vi.fn() }, updater: {} },
    matchMedia: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }),
    setTimeout,
    clearTimeout
  })
})

function renderCard(status: UpdateStatus): string {
  storeState.updateStatus = status
  return renderToStaticMarkup(<UpdateCard />)
}

function renderSettings(status: UpdateStatus): string {
  storeState.updateStatus = status
  return renderToStaticMarkup(<GeneralUpdateSettingsSection />)
}

describe('disabled updater never reads "up to date" (#107)', () => {
  it.each(DISABLED)(
    'manual check with updates off ($reason) says the install script manages updates',
    (status) => {
      const markup = renderCard({ ...status, userInitiated: true })
      expect(markup).toContain(OFF_TEXT)
      expect(markup).not.toMatch(UP_TO_DATE)
      expect(shouldMountUpdateCardForStatus({ ...status, userInitiated: true })).toBe(true)
    }
  )

  it.each(DISABLED)('background disabled status ($reason) shows no card', (status) => {
    expect(shouldMountUpdateCardForStatus(status)).toBe(false)
    expect(renderCard(status)).toBe('')
  })

  it.each(DISABLED)(
    'Settings shows updates are off ($reason), not "latest" or "checked on launch"',
    (status) => {
      const markup = renderSettings(status)
      expect(markup).toContain(OFF_TEXT)
      expect(markup).not.toMatch(UP_TO_DATE)
      expect(markup).not.toContain('checked automatically')
    }
  )

  it('a real no-update result still reads up to date', () => {
    expect(renderCard({ state: 'not-available', userInitiated: true })).toMatch(UP_TO_DATE)
    expect(renderSettings({ state: 'not-available' })).toMatch(UP_TO_DATE)
  })
})
