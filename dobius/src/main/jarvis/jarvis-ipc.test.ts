import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'

type Handler = (...args: unknown[]) => unknown

const electron = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  shortcutHandler: null as null | (() => void),
  registerResult: true,
  focused: null as unknown,
  userData: ''
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => electron.userData
  },
  BrowserWindow: { getFocusedWindow: () => electron.focused },
  globalShortcut: {
    register: (_accelerator: string, handler: () => void) => {
      electron.shortcutHandler = handler
      return electron.registerResult
    },
    unregister: () => undefined
  },
  ipcMain: {
    handle: (channel: string, handler: Handler) => electron.handlers.set(channel, handler),
    removeHandler: (channel: string) => electron.handlers.delete(channel)
  }
}))

vi.mock('../speech/speech-runtime-service', () => ({
  getSpeechSttService: () => ({ startDictation: async () => undefined })
}))

vi.mock('../window/self-edit-window', () => ({
  closeSelfEditWindow: () => undefined,
  showSelfEditProposal: () => undefined
}))

vi.mock('./self-edit-repo-root', () => ({
  resolveSelfEditRepoRoot: () => ({ ok: false, error: 'test: no repo root' })
}))

vi.mock('./elevenlabs-key-store', () => ({
  clearElevenLabsApiKey: () => undefined,
  dropLegacyElevenLabsKeyFromSettings: () => undefined,
  getElevenLabsApiKeyStatus: () => ({ configured: false, sessionOnly: false, unreadable: false }),
  migrateElevenLabsKeyOutOfSettings: () => undefined,
  resolveElevenLabsApiKey: () => '',
  saveElevenLabsApiKey: () => ({ configured: false, sessionOnly: false, unreadable: false })
}))

type FakeWindow = { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } }

function fakeWindow(): FakeWindow {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } }
}

function fakeStore(jarvisEnabled: boolean): { store: Store; updateSettings: ReturnType<typeof vi.fn> } {
  const updateSettings = vi.fn()
  const store = {
    getSettings: () => ({ voice: { jarvisEnabled } }),
    updateSettings
  } as unknown as Store
  return { store, updateSettings }
}

// Why a fresh module graph: the Jarvis service is a process singleton.
async function register(store: Store, mainWindow: FakeWindow): Promise<void> {
  vi.resetModules()
  const { registerJarvisIpcHandlers } = await import('./jarvis-ipc')
  registerJarvisIpcHandlers(store, mainWindow as unknown as BrowserWindow)
}

async function status(): Promise<{ shortcutActive: boolean }> {
  return (await electron.handlers.get('jarvis:status')?.()) as { shortcutActive: boolean }
}

beforeEach(() => {
  electron.handlers.clear()
  electron.shortcutHandler = null
  electron.registerResult = true
  electron.focused = null
  electron.userData = mkdtempSync(join(tmpdir(), 'jarvis-ipc-test-'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(electron.userData, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('restoring Jarvis mode at launch (#122-F9)', () => {
  it('keeps jarvisEnabled on and reports the refused ⌘T grab', async () => {
    electron.registerResult = false
    const { store, updateSettings } = fakeStore(true)
    const main = fakeWindow()
    await register(store, main)
    expect(updateSettings).not.toHaveBeenCalled()
    expect(await status()).toMatchObject({ shortcutActive: false })
    expect(main.webContents.send).toHaveBeenCalledWith('jarvis:state', {
      state: 'error',
      reason: 'global-shortcut-unavailable'
    })
    expect(console.warn).toHaveBeenCalled()
  })

  it('claims the shortcut when it is free, without rewriting settings', async () => {
    const { store, updateSettings } = fakeStore(true)
    await register(store, fakeWindow())
    expect(updateSettings).not.toHaveBeenCalled()
    expect(await status()).toMatchObject({ shortcutActive: true })
  })
})

describe('⌘T routing (#89)', () => {
  it('reaches the main window while the self-edit window is focused', async () => {
    const { store } = fakeStore(true)
    const main = fakeWindow()
    const selfEdit = fakeWindow()
    await register(store, main)
    main.webContents.send.mockClear()
    electron.focused = selfEdit
    electron.shortcutHandler?.()
    expect(selfEdit.webContents.send).not.toHaveBeenCalled()
    expect(main.webContents.send).toHaveBeenCalledWith(
      'jarvis:ptt-pressed',
      expect.objectContaining({ at: expect.any(Number) })
    )
  })
})
