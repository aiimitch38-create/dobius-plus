import { describe, expect, it } from 'vitest'
import {
  resolveAppLook,
  resolveEffectiveActiveView,
  resolveRequestedActiveView,
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
  it('is the Board when the setting is unset or unrecognized', () => {
    expect(resolveAppLook(undefined)).toBe('board')
    expect(resolveAppLook(null)).toBe('board')
    expect(resolveAppLook({})).toBe('board')
    expect(resolveAppLook({ appLook: 'board' })).toBe('board')
    expect(resolveAppLook({ appLook: 'bogus' as unknown as AppLook })).toBe('board')
  })

  it('ignores a saved Classic look: the retired look still opens on the Board at startup', () => {
    const saved = { appLook: 'classic' as const }
    expect(resolveAppLook(saved)).toBe('board')
    // The store boots on 'board'; with the look ignored, a workspace renders the Board...
    expect(resolveEffectiveActiveView('board', 'wt-1')).toBe('board')
    // ...and no workspace still renders Landing.
    expect(resolveEffectiveActiveView('board', null)).toBe('terminal')
  })
})

describe('resolveRequestedActiveView', () => {
  it('lands requests for the retired Classic terminal view on the Board', () => {
    expect(resolveRequestedActiveView('terminal')).toBe('board')
  })

  it('passes every other view through', () => {
    expect(resolveRequestedActiveView('board')).toBe('board')
    expect(resolveRequestedActiveView('home')).toBe('home')
    expect(resolveRequestedActiveView('settings')).toBe('settings')
    expect(resolveRequestedActiveView('tasks')).toBe('tasks')
  })
})
