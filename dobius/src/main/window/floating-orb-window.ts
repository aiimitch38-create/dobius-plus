import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { createAppRendererWebPreferences } from './createMainWindow'
import { registerRendererWindow } from './renderer-window-registry'
import { attachWebviewHardening } from './webview-hardening'

// Structure cloned from floating-phone-window.ts: frameless transparent
// always-on-top singleton with process-lifetime persisted bounds.
const ORB_SIZE = 120

type OrbBounds = { x: number; y: number; width: number; height: number }

let floatingOrbWindow: BrowserWindow | null = null
let persistedOrbBounds: OrbBounds | null = null

function isFiniteBounds(value: OrbBounds): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite)
}

function clampOrbBounds(bounds?: OrbBounds | null): OrbBounds {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const width = Math.min(bounds?.width ?? ORB_SIZE, display.workArea.width)
  const height = Math.min(bounds?.height ?? ORB_SIZE, display.workArea.height)
  // Why cursor-relative default: a voice HUD should appear near the pointer,
  // not wherever the last project window happened to sit.
  const targetX = bounds?.x ?? cursor.x - Math.floor(ORB_SIZE / 2)
  const targetY = bounds?.y ?? cursor.y - Math.floor(ORB_SIZE / 2)
  return {
    x: Math.max(
      display.workArea.x,
      Math.min(targetX, display.workArea.x + display.workArea.width - width)
    ),
    y: Math.max(
      display.workArea.y,
      Math.min(targetY, display.workArea.y + display.workArea.height - height)
    ),
    width,
    height
  }
}

function rememberOrbBounds(win: BrowserWindow): void {
  const [x, y] = win.getPosition()
  const [width, height] = win.getSize()
  persistedOrbBounds = { x, y, width, height }
}

export function openFloatingOrbWindow(): { ok: boolean; windowId?: number } {
  if (floatingOrbWindow && !floatingOrbWindow.isDestroyed()) {
    floatingOrbWindow.focus()
    return { ok: true, windowId: floatingOrbWindow.id }
  }

  const win = new BrowserWindow({
    ...clampOrbBounds(
      persistedOrbBounds && isFiniteBounds(persistedOrbBounds) ? persistedOrbBounds : null
    ),
    title: 'Jarvis',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: createAppRendererWebPreferences()
  })
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'floating')
  }
  win.on('page-title-updated', (event) => {
    event.preventDefault()
  })
  win.on('moved', () => rememberOrbBounds(win))
  win.on('resized', () => rememberOrbBounds(win))
  win.once('closed', () => {
    if (floatingOrbWindow === win) {
      floatingOrbWindow = null
    }
  })

  floatingOrbWindow = win
  registerRendererWindow(win)
  attachWebviewHardening(win.webContents)

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/orb`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/orb' })
  }

  return { ok: true, windowId: win.id }
}

export function closeFloatingOrbWindow(): void {
  const win = getFloatingOrbWindow()
  win?.close()
}

export function getFloatingOrbWindow(): BrowserWindow | null {
  if (floatingOrbWindow && !floatingOrbWindow.isDestroyed()) {
    return floatingOrbWindow
  }
  return null
}

export function registerFloatingOrbWindowHandlers(): void {
  ipcMain.removeHandler('orb:close')
  ipcMain.handle('orb:close', (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
