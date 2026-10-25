import { describe, expect, it } from 'vitest'
import {
  resolveAppLook,
  resolveEffectiveActiveView,
  resolveRequestedActiveView,
  shouldShowBoardStartupCover,
  type AppLook
} from './board-effective-view'

describe('resolveEffectiveActiveView', () => {
  it('renders the Board as Home (never the Classic Landing) when no workspace is active', () => {
    expect(resolveEffectiveActiveView('board', null)).toBe('home')
    expect(resolveEffectiveActiveView('board', null)).not.toBe('terminal')
  })

  it('keeps the Board once a workspace is active, and leaves other views alone', () => {
    expect(resolveEffectiveActiveView('board', 'wt-1')).toBe('board')
    expect(resolveEffectiveActiveView('home', null)).toBe('home')
    expect(resolveEffectiveActiveView('settings', null)).toBe('settings')
  })
})

describe('shouldShowBoardStartupCover', () => {
  it('covers the Board/Home views until the workspace session has hydrated', () => {
    expect(
      shouldShowBoardStartupCover({
        view: 'board',
        workspaceSessionHydrated: false,
        workspaceSessionReady: false
      })
    ).toBe(true)
    expect(
      shouldShowBoardStartupCover({
        view: 'home',
        workspaceSessionHydrated: false,
        workspaceSessionReady: false
      })
    ).toBe(true)
  })

  it('lifts once the session is hydrated, or once a failed hydration unblocked the UI', () => {
    expect(
      shouldShowBoardStartupCover({
        view: 'board',
        workspaceSessionHydrated: true,
        workspaceSessionReady: false
      })
    ).toBe(false)
    expect(
      shouldShowBoardStartupCover({
        view: 'board',
        workspaceSessionHydrated: false,
        workspaceSessionReady: true
      })
    ).toBe(false)
  })

  it('never covers non-Board views', () => {
    expect(
      shouldShowBoardStartupCover({
        view: 'settings',
        workspaceSessionHydrated: false,
        workspaceSessionReady: false
      })
    ).toBe(false)
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
    // ...and no workspace renders Home, still under the Board look.
    expect(resolveEffectiveActiveView('board', null)).toBe('home')
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
