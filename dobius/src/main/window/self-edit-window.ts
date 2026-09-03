import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { createAppRendererWebPreferences } from './createMainWindow'
import { registerRendererWindow } from './renderer-window-registry'
import { attachWebviewHardening } from './webview-hardening'

export const SELF_EDIT_PROPOSAL_CHANNEL = 'jarvis:self-edit-proposal'

const WIDTH = 720
const HEIGHT = 560

let selfEditWindow: BrowserWindow | null = null

/**
 * The review surface for a change Adam wants to make to his own code. A normal
 * titled window, not a HUD: this is something the user reads carefully before
 * approving, so it must be movable, resizable, and focusable.
 */
export function openSelfEditWindow(): BrowserWindow {
  if (selfEditWindow && !selfEditWindow.isDestroyed()) {
    selfEditWindow.show()
    selfEditWindow.focus()
    return selfEditWindow
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const win = new BrowserWindow({
    width: Math.min(WIDTH, display.workArea.width),
    height: Math.min(HEIGHT, display.workArea.height),
    title: 'Adam is editing his code',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    alwaysOnTop: true,
    show: true,
    autoHideMenuBar: true,
    webPreferences: createAppRendererWebPreferences()
  })

  win.once('closed', () => {
    if (selfEditWindow === win) {
      selfEditWindow = null
    }
  })

  selfEditWindow = win
  registerRendererWindow(win)
  attachWebviewHardening(win.webContents)

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/self-edit`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/self-edit' })
  }
  return win
}

export function getSelfEditWindow(): BrowserWindow | null {
  return selfEditWindow && !selfEditWindow.isDestroyed() ? selfEditWindow : null
}

/**
 * Shows a proposal, waiting for the window's first paint when it had to be
 * created — a send() before the renderer subscribes would be dropped.
 */
export function showSelfEditProposal(payload: unknown): void {
  const existing = getSelfEditWindow()
  const win = existing ?? openSelfEditWindow()
  if (existing) {
    win.show()
    win.webContents.send(SELF_EDIT_PROPOSAL_CHANNEL, payload)
    return
  }
  win.webContents.once('did-finish-load', () => {
    win.webContents.send(SELF_EDIT_PROPOSAL_CHANNEL, payload)
  })
}

export function closeSelfEditWindow(): void {
  getSelfEditWindow()?.close()
}
