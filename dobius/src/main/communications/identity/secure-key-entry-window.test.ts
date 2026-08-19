import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let nextWebContentsId = 1

class FakeWebContents extends EventEmitter {
  id: number
  setWindowOpenHandler = vi.fn()

  constructor() {
    super()
    this.id = nextWebContentsId
    nextWebContentsId += 1
  }
}

class FakeBrowserWindow extends EventEmitter {
  webContents = new FakeWebContents()
  loadURL = vi.fn(async () => undefined)
  setMenuBarVisibility = vi.fn()

  close(): void {
    this.emit('closed')
  }
}

const createdWindows: FakeBrowserWindow[] = []

// Not vi.hoisted: vi.doMock (unlike vi.mock) is not hoisted above imports,
// so this plain top-level const is already initialized by the time any
// vi.doMock factory that closes over it actually runs.
const electronMock = {
  BrowserWindow: vi.fn(),
  ipcMain: new EventEmitter()
}

async function loadModule() {
  vi.resetModules()
  createdWindows.length = 0
  electronMock.ipcMain.removeAllListeners()
  // A plain function, not an arrow function: vi.fn() used with `new` invokes
  // the mock implementation as a constructor, which arrow functions cannot be.
  electronMock.BrowserWindow.mockImplementation(function fakeBrowserWindowCtor() {
    const win = new FakeBrowserWindow()
    createdWindows.push(win)
    return win
  })
  vi.doMock('electron', () => electronMock)
  return import('./secure-key-entry-window')
}

/** Simulates an ipcMain message the way Electron itself would shape `event.sender`. */
function fakeIpcEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

beforeEach(() => {
  nextWebContentsId = 1
})

describe('secure-key-entry-window sender verification', () => {
  it('promptForIdentityImport ignores a submit from a foreign sender and still resolves the real one', async () => {
    const module = await loadModule()
    const promise = module.promptForIdentityImport()
    const win = createdWindows[0]
    const submitChannel = `dobius-secure-key-entry:import-submit:${win.webContents.id}`

    // A foreign renderer (e.g. the Communications webview) tries to inject a key.
    electronMock.ipcMain.emit(submitChannel, fakeIpcEvent(9999), { input: 'nsec1attacker', password: '' })

    // The real ephemeral window's own submit, a moment later.
    electronMock.ipcMain.emit(submitChannel, fakeIpcEvent(win.webContents.id), {
      input: 'nsec1real',
      password: 'pw'
    })

    const result = await promise
    expect(result).toEqual({ cancelled: false, input: 'nsec1real', password: 'pw' })
  })

  it('promptForIdentityImport ignores a cancel from a foreign sender', async () => {
    const module = await loadModule()
    const promise = module.promptForIdentityImport()
    const win = createdWindows[0]
    const cancelChannel = `dobius-secure-key-entry:import-cancel:${win.webContents.id}`
    const submitChannel = `dobius-secure-key-entry:import-submit:${win.webContents.id}`

    electronMock.ipcMain.emit(cancelChannel, fakeIpcEvent(9999))
    electronMock.ipcMain.emit(submitChannel, fakeIpcEvent(win.webContents.id), { input: 'nsec1real', password: '' })

    const result = await promise
    expect(result).toEqual({ cancelled: false, input: 'nsec1real', password: '' })
  })

  it('promptForIdentityImport rejects a malformed payload from the real sender instead of resolving garbage', async () => {
    const module = await loadModule()
    const promise = module.promptForIdentityImport()
    const win = createdWindows[0]
    const submitChannel = `dobius-secure-key-entry:import-submit:${win.webContents.id}`

    electronMock.ipcMain.emit(submitChannel, fakeIpcEvent(win.webContents.id), { input: '' })
    electronMock.ipcMain.emit(submitChannel, fakeIpcEvent(win.webContents.id), null)
    electronMock.ipcMain.emit(submitChannel, fakeIpcEvent(win.webContents.id), { input: 'nsec1valid', password: 42 })

    const result = await promise
    expect(result).toEqual({ cancelled: false, input: 'nsec1valid', password: '' })
  })

  it('promptForIdentityImport resolves cancelled when the window is closed without a submit', async () => {
    const module = await loadModule()
    const promise = module.promptForIdentityImport()
    createdWindows[0].close()

    expect(await promise).toEqual({ cancelled: true })
  })

  it('revealNsecInSecureWindow ignores a done signal from a foreign sender', async () => {
    const module = await loadModule()
    const promise = module.revealNsecInSecureWindow('nsec1whatever', 'a'.repeat(64))
    const win = createdWindows[0]
    const channel = `dobius-secure-key-entry:reveal-done:${win.webContents.id}`

    electronMock.ipcMain.emit(channel, fakeIpcEvent(9999))
    expect(await Promise.race([promise, Promise.resolve('pending')])).toBe('pending')

    electronMock.ipcMain.emit(channel, fakeIpcEvent(win.webContents.id))
    await expect(promise).resolves.toBeUndefined()
  })
})
