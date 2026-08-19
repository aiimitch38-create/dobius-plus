import { describe, expect, it, vi } from 'vitest'
import { setWindowVibrancy, type VibrancyWindowHandle } from './window-vibrancy'

function fakeWindow(destroyed = false): VibrancyWindowHandle {
  return { isDestroyed: () => destroyed, setVibrancy: vi.fn() }
}

describe('setWindowVibrancy', () => {
  it('is a documented no-op off macOS', () => {
    const result = setWindowVibrancy(
      { enabled: true, material: 'sidebar' },
      { platform: 'win32', getTargetWindows: () => [fakeWindow()] }
    )
    expect(result).toEqual({ applied: false, reason: 'unsupported_platform' })
  })

  it('reports no target window instead of throwing', () => {
    const result = setWindowVibrancy(
      { enabled: true, material: 'sidebar' },
      { platform: 'darwin', getTargetWindows: () => [] }
    )
    expect(result).toEqual({ applied: false, reason: 'no_target_window' })
  })

  it('skips already-destroyed windows', () => {
    const destroyed = fakeWindow(true)
    const result = setWindowVibrancy(
      { enabled: true, material: 'sidebar' },
      { platform: 'darwin', getTargetWindows: () => [destroyed] }
    )
    expect(result).toEqual({ applied: false, reason: 'no_target_window' })
    expect(destroyed.setVibrancy).not.toHaveBeenCalled()
  })

  it('applies the material to every live target window when enabled', () => {
    const a = fakeWindow()
    const b = fakeWindow()
    const result = setWindowVibrancy(
      { enabled: true, material: 'sidebar' },
      { platform: 'darwin', getTargetWindows: () => [a, b] }
    )
    expect(result).toEqual({ applied: true, windowCount: 2 })
    expect(a.setVibrancy).toHaveBeenCalledWith('sidebar')
    expect(b.setVibrancy).toHaveBeenCalledWith('sidebar')
  })

  it('clears vibrancy (passes null) when disabled', () => {
    const win = fakeWindow()
    setWindowVibrancy(
      { enabled: false, material: 'sidebar' },
      { platform: 'darwin', getTargetWindows: () => [win] }
    )
    expect(win.setVibrancy).toHaveBeenCalledWith(null)
  })
})
