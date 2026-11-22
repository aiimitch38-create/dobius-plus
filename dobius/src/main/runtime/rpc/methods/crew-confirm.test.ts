import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  windows: [] as unknown[],
  showMessageBox: vi.fn()
}))

vi.mock('electron', () => ({
  app: { focus: vi.fn() },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => electron.windows)
  },
  dialog: { showMessageBox: electron.showMessageBox }
}))

import { appConfirmationGate, showConfirmDialog } from './crew-confirm'

const request = { title: 'Resume?', message: 'm', detail: 'd', confirmLabel: 'Resume crew' }

describe('native crew confirmation dialog', () => {
  beforeEach(() => {
    electron.windows = []
    electron.showMessageBox.mockReset()
  })

  it('answers no without a window, and never shows a parentless dialog', async () => {
    await expect(showConfirmDialog(request, new AbortController().signal)).resolves.toBe(false)
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })

  it('opens on the app window with Cancel as the default and the abort signal attached', async () => {
    const win = { isDestroyed: () => false }
    electron.windows = [win]
    electron.showMessageBox.mockResolvedValue({ response: 1 })
    const signal = new AbortController().signal
    await expect(showConfirmDialog(request, signal)).resolves.toBe(true)
    expect(electron.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        buttons: ['Cancel', 'Resume crew'],
        defaultId: 0,
        cancelId: 0,
        signal
      })
    )
  })

  it('treats Cancel as no, through the shared production gate', async () => {
    electron.windows = [{ isDestroyed: () => false }]
    electron.showMessageBox.mockResolvedValue({ response: 0 })
    await expect(appConfirmationGate(request, {} as never)).rejects.toThrow('Not confirmed')
  })
})
