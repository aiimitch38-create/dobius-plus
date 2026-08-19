import { describe, expect, it } from 'vitest'
import { isAutoUpdateSupported, isRunningFromAppImage } from './auto-update-support'

describe('isAutoUpdateSupported', () => {
  it('is true on macOS', () => {
    expect(
      isAutoUpdateSupported({ platform: 'darwin', isRunningFromAppImage: () => false })
    ).toBe(true)
  })

  it('is true on Windows', () => {
    expect(
      isAutoUpdateSupported({ platform: 'win32', isRunningFromAppImage: () => false })
    ).toBe(true)
  })

  it('is true on Linux when running from an AppImage', () => {
    expect(
      isAutoUpdateSupported({ platform: 'linux', isRunningFromAppImage: () => true })
    ).toBe(true)
  })

  it('is false on Linux when not running from an AppImage (e.g. a .deb install)', () => {
    expect(
      isAutoUpdateSupported({ platform: 'linux', isRunningFromAppImage: () => false })
    ).toBe(false)
  })
})

describe('isRunningFromAppImage', () => {
  it('is true when APPIMAGE is set', () => {
    expect(isRunningFromAppImage({ APPIMAGE: '/tmp/Dobius.AppImage' })).toBe(true)
  })

  it('is true when APPDIR is set', () => {
    expect(isRunningFromAppImage({ APPDIR: '/tmp/.mount_dobius' })).toBe(true)
  })

  it('is false when neither is set', () => {
    expect(isRunningFromAppImage({})).toBe(false)
  })
})
