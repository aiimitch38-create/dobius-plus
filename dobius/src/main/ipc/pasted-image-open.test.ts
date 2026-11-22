import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, ipcMain: {}, shell: {} }))
vi.mock('../window/renderer-window-registry', () => ({
  isRegisteredRendererWebContents: () => true
}))

import { resolvePastedImageToOpen, type PastedImageFs } from './pasted-image-open'

const TEMP = '/var/folders/xy/T'
const NAME = 'dobius-paste-1700000000000-0f8fad5b-d9cb-469f-a165-70867728950e.png'

function fs(kind: 'file' | 'symlink' | 'dir' | 'missing'): PastedImageFs {
  return {
    lstat: async () => {
      if (kind === 'missing') {
        throw new Error('ENOENT')
      }
      return { isFile: () => kind === 'file', isSymbolicLink: () => kind === 'symlink' }
    },
    realpath: async (p) => p
  }
}

describe('resolvePastedImageToOpen', () => {
  it('opens an image Dobius saved from a paste in the temp folder', async () => {
    await expect(resolvePastedImageToOpen(`${TEMP}/${NAME}`, TEMP, fs('file'))).resolves.toBe(
      `${TEMP}/${NAME}`
    )
  })

  it('refuses a symlink, a folder or a missing file', async () => {
    for (const kind of ['symlink', 'dir', 'missing'] as const) {
      await expect(resolvePastedImageToOpen(`${TEMP}/${NAME}`, TEMP, fs(kind))).resolves.toBeNull()
    }
  })

  it('refuses the same name outside the local temp folder (an SSH pane path)', async () => {
    await expect(resolvePastedImageToOpen(`/tmp/${NAME}`, TEMP, fs('file'))).resolves.toBeNull()
  })

  it('refuses any other name, a relative path, a network path or a non-string', async () => {
    const f = fs('file')
    await expect(resolvePastedImageToOpen(`${TEMP}/evil.app`, TEMP, f)).resolves.toBeNull()
    await expect(resolvePastedImageToOpen(`${TEMP}/dobius-paste-1-x.png`, TEMP, f)).resolves.toBeNull()
    await expect(resolvePastedImageToOpen(NAME, TEMP, f)).resolves.toBeNull()
    await expect(resolvePastedImageToOpen(`\\\\server\\share\\${NAME}`, TEMP, f)).resolves.toBeNull()
    await expect(resolvePastedImageToOpen(42, TEMP, f)).resolves.toBeNull()
  })
})
