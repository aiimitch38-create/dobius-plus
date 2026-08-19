import { describe, expect, it, vi } from 'vitest'
import {
  performTitleBarDoubleClickAction,
  resolveTitleBarDoubleClickAction,
  type TitleBarWindowHandle
} from './title-bar-double-click'

function fakeWindow(overrides: Partial<TitleBarWindowHandle> = {}): TitleBarWindowHandle {
  return {
    isDestroyed: () => false,
    isMaximized: () => false,
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    ...overrides
  }
}

describe('resolveTitleBarDoubleClickAction', () => {
  it('maps Minimize to minimize', () => {
    expect(resolveTitleBarDoubleClickAction('Minimize')).toBe('minimize')
  })

  it('maps Maximize and Fill to zoom', () => {
    expect(resolveTitleBarDoubleClickAction('Maximize')).toBe('zoom')
    expect(resolveTitleBarDoubleClickAction('Fill')).toBe('zoom')
  })

  it('maps anything else (including null) to none', () => {
    expect(resolveTitleBarDoubleClickAction('None')).toBe('none')
    expect(resolveTitleBarDoubleClickAction(null)).toBe('none')
  })
})

describe('performTitleBarDoubleClickAction', () => {
  it('is a documented no-op off macOS', () => {
    const result = performTitleBarDoubleClickAction({
      platform: 'win32',
      getDoubleClickPreference: () => 'Minimize',
      getTargetWindow: () => fakeWindow()
    })
    expect(result).toEqual({ performed: false, reason: 'unsupported_platform' })
  })

  it('reports no target window instead of throwing', () => {
    const result = performTitleBarDoubleClickAction({
      platform: 'darwin',
      getDoubleClickPreference: () => 'Minimize',
      getTargetWindow: () => null
    })
    expect(result).toEqual({ performed: false, reason: 'no_target_window' })
  })

  it('minimizes the window on macOS when the preference is Minimize', () => {
    const win = fakeWindow()
    const result = performTitleBarDoubleClickAction({
      platform: 'darwin',
      getDoubleClickPreference: () => 'Minimize',
      getTargetWindow: () => win
    })
    expect(result).toEqual({ performed: true, action: 'minimize' })
    expect(win.minimize).toHaveBeenCalledOnce()
  })

  it('maximizes an unmaximized window when the preference zooms', () => {
    const win = fakeWindow({ isMaximized: () => false })
    performTitleBarDoubleClickAction({
      platform: 'darwin',
      getDoubleClickPreference: () => 'Maximize',
      getTargetWindow: () => win
    })
    expect(win.maximize).toHaveBeenCalledOnce()
    expect(win.unmaximize).not.toHaveBeenCalled()
  })

  it('unmaximizes an already-maximized window when the preference zooms', () => {
    const win = fakeWindow({ isMaximized: () => true })
    performTitleBarDoubleClickAction({
      platform: 'darwin',
      getDoubleClickPreference: () => 'Maximize',
      getTargetWindow: () => win
    })
    expect(win.unmaximize).toHaveBeenCalledOnce()
    expect(win.maximize).not.toHaveBeenCalled()
  })

  it('does nothing to the window when the preference is None', () => {
    const win = fakeWindow()
    const result = performTitleBarDoubleClickAction({
      platform: 'darwin',
      getDoubleClickPreference: () => 'None',
      getTargetWindow: () => win
    })
    expect(result).toEqual({ performed: true, action: 'none' })
    expect(win.minimize).not.toHaveBeenCalled()
    expect(win.maximize).not.toHaveBeenCalled()
    expect(win.unmaximize).not.toHaveBeenCalled()
  })
})
