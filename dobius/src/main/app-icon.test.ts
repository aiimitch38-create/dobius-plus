import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  browserWindowGetAllWindowsMock,
  childProcessExecFileMock,
  createFromPathMock,
  dockSetIconMock,
  getAppPathMock,
  isMock,
  windowSetIconMock
} = vi.hoisted(() => ({
  browserWindowGetAllWindowsMock: vi.fn(),
  childProcessExecFileMock: vi.fn(),
  createFromPathMock: vi.fn(),
  dockSetIconMock: vi.fn(),
  getAppPathMock: vi.fn(),
  isMock: { dev: false },
  windowSetIconMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: childProcessExecFileMock
}))

vi.mock('electron', () => ({
  app: { dock: { setIcon: dockSetIconMock }, getPath: getAppPathMock, isPackaged: true },
  BrowserWindow: { getAllWindows: browserWindowGetAllWindowsMock },
  nativeImage: { createFromPath: createFromPathMock }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: isMock
}))

vi.mock('../../resources/icon.png?asset', () => ({
  default: 'classic-icon'
}))

vi.mock('../../resources/icon-dev.png?asset', () => ({
  default: 'classic-dev-icon'
}))

vi.mock('../../resources/app-icons/dobius-watercolor.png?asset', () => ({
  default: 'watercolor-icon'
}))

vi.mock('../../resources/app-icons/dobius-blue.png?asset', () => ({
  default: 'blue-icon'
}))

import { applyAppIcon, getAppIconPath } from './app-icon'

describe('app icon selection', () => {
  beforeEach(() => {
    browserWindowGetAllWindowsMock.mockReset()
    childProcessExecFileMock.mockReset()
    createFromPathMock.mockReset()
    dockSetIconMock.mockReset()
    getAppPathMock.mockReset()
    windowSetIconMock.mockReset()
    isMock.dev = false
  })

  it('resolves classic, watercolor, blue, and invalid icon ids', () => {
    expect(getAppIconPath('classic')).toBe('classic-icon')
    expect(getAppIconPath('watercolor')).toBe('watercolor-icon')
    expect(getAppIconPath('blue')).toBe('blue-icon')
    expect(getAppIconPath('missing')).toBe('classic-icon')
  })

  it('applies the selected icon to the live dock and non-destroyed windows', () => {
    const image = { isEmpty: () => false }
    const destroyedWindowSetIcon = vi.fn()
    createFromPathMock.mockReturnValue(image)
    browserWindowGetAllWindowsMock.mockReturnValue([
      { isDestroyed: () => false, setIcon: windowSetIconMock },
      { isDestroyed: () => true, setIcon: destroyedWindowSetIcon }
    ])

    applyAppIcon('watercolor')

    expect(createFromPathMock).toHaveBeenCalledWith('watercolor-icon')
    if (process.platform === 'darwin') {
      expect(dockSetIconMock).toHaveBeenCalledWith(image)
    } else {
      expect(dockSetIconMock).not.toHaveBeenCalled()
    }
    expect(windowSetIconMock).toHaveBeenCalledWith(image)
    expect(destroyedWindowSetIcon).not.toHaveBeenCalled()
  })

  it('does not update the dock or windows when the selected image is empty', () => {
    createFromPathMock.mockReturnValue({ isEmpty: () => true })

    applyAppIcon('blue')

    expect(dockSetIconMock).not.toHaveBeenCalled()
    expect(browserWindowGetAllWindowsMock).not.toHaveBeenCalled()
  })

  it('leaves signed bundle contents untouched when applying a custom icon', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'dobius-signed-app-icon-'))
    const appBundle = join(fixtureRoot, 'Dobius+.app')
    const metadataFixture = join(appBundle, 'signature-metadata.fixture')
    const fixtureContents = Buffer.from('signed bundle metadata sentinel')
    mkdirSync(appBundle)
    writeFileSync(metadataFixture, fixtureContents)
    getAppPathMock.mockReturnValue(join(appBundle, 'Contents', 'MacOS', 'Dobius+'))
    createFromPathMock.mockReturnValue({ isEmpty: () => false })
    browserWindowGetAllWindowsMock.mockReturnValue([])
    childProcessExecFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        optionsOrCallback: unknown,
        callback?: (error: Error | null) => void
      ) => {
        const onComplete =
          typeof optionsOrCallback === 'function'
            ? (optionsOrCallback as (error: Error | null) => void)
            : callback
        onComplete?.(null)
      }
    )

    try {
      Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' })
      applyAppIcon('blue')
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(childProcessExecFileMock).not.toHaveBeenCalled()
      expect(readFileSync(metadataFixture)).toEqual(fixtureContents)
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
