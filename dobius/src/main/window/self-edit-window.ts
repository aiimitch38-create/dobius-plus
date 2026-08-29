import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { createAppRendererWebPreferences } from './createMainWindow'
import { registerRendererWindow } from './renderer-window-registry'
import { attachWebviewHardening } from './webview-hardening'

export const SELF_EDIT_PROPOSAL_CHANNEL = 'jarvis:self-edit-proposal'
/** A shell command Adam wants to run that writes to the machine. */
export const SHELL_COMMAND_PROPOSAL_CHANNEL = 'jarvis:shell-command-proposal'

const EDIT_TITLE = 'Adam is editing his code'
const COMMAND_TITLE = 'Adam wants to run a command'

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
    title: EDIT_TITLE,
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
function showProposal(channel: string, payload: unknown, title: string): void {
  const existing = getSelfEditWindow()
  const win = existing ?? openSelfEditWindow()
  // Why retitle: one window serves both kinds of review, and a shell command
  // sitting under "Adam is editing his code" misdescribes what is being approved.
  win.setTitle(title)
  if (existing) {
    win.show()
    win.webContents.send(channel, payload)
    return
  }
  win.webContents.once('did-finish-load', () => {
    win.webContents.send(channel, payload)
  })
}

export function showSelfEditProposal(payload: unknown): void {
  showProposal(SELF_EDIT_PROPOSAL_CHANNEL, payload, EDIT_TITLE)
}

/**
 * Shows a command waiting for approval.
 *
 * The window's Run button is the only thing on the machine that can execute it:
 * the pending id travels on this payload and is never given to the model.
 */
export function showShellCommandProposal(payload: unknown): void {
  showProposal(SHELL_COMMAND_PROPOSAL_CHANNEL, payload, COMMAND_TITLE)
}

export function closeSelfEditWindow(): void {
  getSelfEditWindow()?.close()
}
