import { describe, expect, it } from 'vitest'
import {
  appLookViewUpdate,
  resolveAppLook,
  resolveEffectiveActiveView,
  resolveStartupActiveView,
  type AppLook
} from './board-effective-view'

describe('resolveEffectiveActiveView', () => {
  it('falls back to the terminal view (Landing) when the Board has no workspace', () => {
    expect(resolveEffectiveActiveView('board', null)).toBe('terminal')
  })

  it('keeps the Board once a workspace is active, and leaves other views alone', () => {
    expect(resolveEffectiveActiveView('board', 'wt-1')).toBe('board')
    expect(resolveEffectiveActiveView('settings', null)).toBe('settings')
  })
})

describe('resolveAppLook', () => {
  it('defaults to the Board when the setting is unset or unrecognized', () => {
    expect(resolveAppLook(undefined)).toBe('board')
    expect(resolveAppLook(null)).toBe('board')
    expect(resolveAppLook({})).toBe('board')
    expect(resolveAppLook({ appLook: 'board' })).toBe('board')
    expect(resolveAppLook({ appLook: 'bogus' as unknown as AppLook })).toBe('board')
  })

  it('reads Classic only when explicitly chosen', () => {
    expect(resolveAppLook({ appLook: 'classic' })).toBe('classic')
  })
})

describe('resolveStartupActiveView', () => {
  it('opens to the Board when the setting is unset or board', () => {
    expect(resolveStartupActiveView('board', null)).toBe('board')
    expect(resolveStartupActiveView('board', {})).toBe('board')
    expect(resolveStartupActiveView('board', { appLook: 'board' })).toBe('board')
  })

  it('opens to the Classic terminal view when the setting is classic', () => {
    expect(resolveStartupActiveView('board', { appLook: 'classic' })).toBe('terminal')
  })

  it('leaves any other already-chosen view alone', () => {
    expect(resolveStartupActiveView('tasks', { appLook: 'classic' })).toBe('tasks')
    expect(resolveStartupActiveView('settings', { appLook: 'classic' })).toBe('settings')
    expect(resolveStartupActiveView('automations', { appLook: 'board' })).toBe('automations')
  })

  it('renders Classic with no active workspace whatever the setting', () => {
    for (const settings of [null, { appLook: 'board' as const }, { appLook: 'classic' as const }]) {
      expect(resolveEffectiveActiveView(resolveStartupActiveView('board', settings), null)).toBe(
        'terminal'
      )
    }
    expect(resolveEffectiveActiveView(resolveStartupActiveView('board', null), 'wt-1')).toBe(
      'board'
    )
  })
})

describe('appLookViewUpdate', () => {
  it('switches the current look view immediately', () => {
    expect(
      appLookViewUpdate({ activeView: 'board', previousViewBeforeSettings: 'terminal' }, 'classic')
    ).toEqual({ activeView: 'terminal' })
    expect(
      appLookViewUpdate({ activeView: 'terminal', previousViewBeforeSettings: 'terminal' }, 'board')
    ).toEqual({ activeView: 'board' })
  })

  it('switches the look under Settings instead of leaving Settings', () => {
    expect(
      appLookViewUpdate({ activeView: 'settings', previousViewBeforeSettings: 'board' }, 'classic')
    ).toEqual({ previousViewBeforeSettings: 'terminal' })
    expect(
      appLookViewUpdate({ activeView: 'settings', previousViewBeforeSettings: 'terminal' }, 'board')
    ).toEqual({ previousViewBeforeSettings: 'board' })
  })

  it('does nothing when already on the chosen look or on another page', () => {
    expect(
      appLookViewUpdate({ activeView: 'board', previousViewBeforeSettings: 'terminal' }, 'board')
    ).toBeNull()
    expect(
      appLookViewUpdate({ activeView: 'settings', previousViewBeforeSettings: 'tasks' }, 'classic')
    ).toBeNull()
    expect(
      appLookViewUpdate({ activeView: 'tasks', previousViewBeforeSettings: 'board' }, 'classic')
    ).toBeNull()
  })
})
