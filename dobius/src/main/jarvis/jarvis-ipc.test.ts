import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
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

const adam = vi.hoisted(() => ({
  ask: vi.fn(async () => ({ kind: 'answer', text: 'Adam Hermes reply' })),
  cancel: vi.fn(),
  close: vi.fn(async () => undefined),
  speak: vi.fn(async () => ({ played: true })),
  created: vi.fn()
}))
vi.mock('./adam-hermes-voice', () => ({
  AdamHermesVoice: class {
    constructor(options: unknown) {
      adam.created(options)
    }
    ask = adam.ask
    cancel = adam.cancel
    close = adam.close
  }
}))
vi.mock('../communications/huddles/huddle-speech-synthesis', () => ({
  getHuddleSpeechQueue: () => adam.speak
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    once: vi.fn(),
    focus: vi.fn(),
    getPath: () => electron.userData
  },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
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

const live = vi.hoisted(() => ({
  ready: true,
  create: vi.fn(async (..._args: unknown[]) => ({ ok: true, answerSdp: 'v=0', sessionId: 's1' }))
}))
vi.mock('./openai-live-session', () => ({
  createOpenAiLiveSession: live.create,
  liveVoiceFailure: (kind: string) => ({ ok: false, kind, error: kind })
}))
vi.mock('../../shared/live-voice-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/live-voice-settings')>()
  return {
    ...actual,
    get OPENAI_LIVE_CALL_READY() {
      return live.ready
    }
  }
})

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

function fakeStore(jarvisEnabled: boolean): {
  store: Store
  updateSettings: ReturnType<typeof vi.fn>
} {
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
  vi.clearAllMocks()
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

describe('Adam Hermes voice routing', () => {
  it('uses one Hermes client for direct Jarvis turns and live-agent text tools', async () => {
    const { store } = fakeStore(true)
    const main = fakeWindow()
    await register(store, main)
    main.webContents.send.mockClear()
    await expect(electron.handlers.get('jarvis:ask')?.({}, 'hello Adam')).resolves.toEqual({
      kind: 'answer',
      text: 'Adam Hermes reply'
    })
    expect(adam.ask).toHaveBeenLastCalledWith('hello Adam')
    expect(adam.speak).toHaveBeenCalledExactlyOnceWith('Adam Hermes reply')
    expect(
      main.webContents.send.mock.calls
        .filter(([channel]) => channel === 'jarvis:state')
        .map(([, data]) => data.state)
    ).toEqual(['thinking', 'speaking', 'idle'])
    await electron.handlers.get('jarvis:askAdamText')?.({}, 'live tool question')
    expect(adam.ask).toHaveBeenLastCalledWith('live tool question')
    expect(adam.speak).toHaveBeenCalledTimes(1)
    expect(adam.created).toHaveBeenCalledTimes(1)
    expect(adam.created).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionFile: join(electron.userData, 'adam-voice-session.json')
      })
    )
    await electron.handlers.get('jarvis:cancelAsk')?.()
    expect(adam.cancel).toHaveBeenCalledTimes(1)
  })
})

describe('OpenAI Live session IPC', () => {
  function liveStore(voice: Record<string, unknown>): Store {
    return { getSettings: () => ({ voice }), updateSettings: vi.fn() } as unknown as Store
  }

  type LiveContents = EventEmitter & {
    id: number
    send: ReturnType<typeof vi.fn>
    isDestroyed: () => boolean
    mainFrame: object
  }

  function liveWindow(id = 7): { window: FakeWindow; contents: LiveContents } {
    const contents = Object.assign(new EventEmitter(), {
      id,
      send: vi.fn(),
      isDestroyed: () => false,
      mainFrame: { name: 'main' }
    }) as LiveContents
    return {
      window: { isDestroyed: () => false, webContents: contents } as unknown as FakeWindow,
      contents
    }
  }

  // An IPC event as the main window's top frame sends it.
  function from(contents: LiveContents): { sender: LiveContents; senderFrame: object } {
    return { sender: contents, senderFrame: contents.mainFrame }
  }

  function handler(channel: string): Handler {
    const found = electron.handlers.get(channel)
    if (!found) {
      throw new Error(`${channel} is not registered`)
    }
    return found
  }

  beforeEach(() => {
    live.ready = true
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes only the offer from the window; voice and idle timeout come from saved settings', async () => {
    const { window, contents } = liveWindow()
    await register(liveStore({ openAiLiveVoice: 'cedar', liveVoiceIdleTimeoutSec: 45 }), window)

    const result = await handler('jarvis:liveSessionConnect')(from(contents), {
      offerSdp: 'v=0 offer',
      voice: 'evil',
      apiKey: 'x'
    })

    expect(result).toEqual({ ok: true, answerSdp: 'v=0', sessionId: 's1' })
    expect(live.create).toHaveBeenCalledWith(
      'v=0 offer',
      { voice: 'cedar', idleTimeoutSec: 45 },
      { signal: expect.any(AbortSignal) }
    )
  })

  it('normalizes bad saved settings and malformed payloads before the session module sees them', async () => {
    const { window, contents } = liveWindow()
    await register(
      liveStore({ openAiLiveVoice: 'BAD VOICE!', liveVoiceIdleTimeoutSec: 9000 }),
      window
    )
    const connect = handler('jarvis:liveSessionConnect')

    await connect(from(contents), 'just a string')
    await connect(from(contents), null)
    await connect(from(contents), ['v=0'])

    expect(live.create).toHaveBeenCalledTimes(3)
    for (const call of live.create.mock.calls) {
      expect(call.slice(0, 2)).toEqual([undefined, { voice: 'marin', idleTimeoutSec: 60 }])
    }
  })

  it('refuses any sender but the main window top frame', async () => {
    const { window, contents } = liveWindow()
    await register(liveStore({}), window)
    const other = liveWindow(99).contents
    const strangers = [
      {},
      { sender: other, senderFrame: other.mainFrame },
      { sender: contents, senderFrame: { name: 'embedded frame' } },
      { sender: contents, senderFrame: null }
    ]

    for (const event of strangers) {
      expect(
        await handler('jarvis:liveSessionConnect')(event, { offerSdp: 'v=0 offer' })
      ).toMatchObject({ ok: false, kind: 'not-allowed' })
    }
    expect(live.create).not.toHaveBeenCalled()
  })

  it('refuses connect unless OpenAI Live is the chosen engine and the live call is ready', async () => {
    const { window, contents } = liveWindow()
    await register(liveStore({ liveVoiceEngine: 'hermes' }), window)
    expect(
      await handler('jarvis:liveSessionConnect')(from(contents), { offerSdp: 'v=0 offer' })
    ).toMatchObject({ ok: false, kind: 'not-ready' })

    live.ready = false
    await register(liveStore({ liveVoiceEngine: 'openai-live' }), window)
    expect(
      await handler('jarvis:liveSessionConnect')(from(contents), { offerSdp: 'v=0 offer' })
    ).toMatchObject({ ok: false, kind: 'not-ready' })
    expect(live.create).not.toHaveBeenCalled()
  })

  it('refuses a second session while one is still being created', async () => {
    const { window, contents } = liveWindow()
    await register(liveStore({}), window)
    let finish: (value: { ok: true; answerSdp: string; sessionId: string }) => void = () =>
      undefined
    live.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const connect = handler('jarvis:liveSessionConnect')

    const first = connect(from(contents), { offerSdp: 'v=0 offer' })
    expect(await connect(from(contents), { offerSdp: 'v=0 offer' })).toMatchObject({
      ok: false,
      kind: 'busy'
    })
    finish({ ok: true, answerSdp: 'v=0', sessionId: 's2' })
    expect(await first).toMatchObject({ ok: true, sessionId: 's2' })
  })

  it('aborts an in-flight create when the requesting window closes', async () => {
    const { window, contents } = liveWindow()
    await register(liveStore({}), window)
    let seenSignal: AbortSignal | undefined
    live.create.mockImplementationOnce((_offer, _options, deps) => {
      seenSignal = (deps as { signal: AbortSignal }).signal
      return new Promise((resolve) => {
        seenSignal?.addEventListener('abort', () =>
          resolve({ ok: false, kind: 'cancelled', error: 'cancelled' } as never)
        )
      })
    })

    const pending = handler('jarvis:liveSessionConnect')(from(contents), { offerSdp: 'v=0 offer' })
    expect(seenSignal?.aborted).toBe(false)
    contents.emit('destroyed')

    expect(await pending).toMatchObject({ ok: false, kind: 'cancelled' })
    expect(seenSignal?.aborted).toBe(true)
    expect(contents.listenerCount('destroyed')).toBe(0)
  })

  it('records which window owns the live session and forgets it when that window closes', async () => {
    const { window, contents } = liveWindow(7)
    await register(liveStore({}), window)
    const { getActiveLiveSessionForTest } = await import('./jarvis-ipc')
    expect(getActiveLiveSessionForTest()).toBeNull()

    await handler('jarvis:liveSessionConnect')(from(contents), { offerSdp: 'v=0 offer' })
    expect(getActiveLiveSessionForTest()).toEqual({ ownerId: 7, sessionId: 's1' })

    contents.emit('destroyed')
    expect(getActiveLiveSessionForTest()).toBeNull()
  })

  it('keeps exactly one owner listener however many times a window connects', async () => {
    const { window, contents } = liveWindow(7)
    await register(liveStore({}), window)
    const { getActiveLiveSessionForTest } = await import('./jarvis-ipc')
    const connect = handler('jarvis:liveSessionConnect')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await connect(from(contents), { offerSdp: 'v=0 offer' })
      expect(contents.listenerCount('destroyed')).toBe(1)
    }
    expect(getActiveLiveSessionForTest()).toEqual({ ownerId: 7, sessionId: 's1' })

    contents.emit('destroyed')
    expect(contents.listenerCount('destroyed')).toBe(0)
    expect(getActiveLiveSessionForTest()).toBeNull()
  })

  it('moves the owner listener when the main window is replaced', async () => {
    const first = liveWindow(7)
    await register(liveStore({}), first.window)
    await handler('jarvis:liveSessionConnect')(from(first.contents), { offerSdp: 'v=0 offer' })
    expect(first.contents.listenerCount('destroyed')).toBe(1)

    // Same module graph, new main window: re-registering drops the old owner.
    const { registerJarvisIpcHandlers, getActiveLiveSessionForTest } = await import('./jarvis-ipc')
    const second = liveWindow(8)
    registerJarvisIpcHandlers(liveStore({}), second.window as unknown as BrowserWindow)
    expect(first.contents.listenerCount('destroyed')).toBe(0)
    expect(getActiveLiveSessionForTest()).toBeNull()

    await handler('jarvis:liveSessionConnect')(from(second.contents), { offerSdp: 'v=0 offer' })
    expect(second.contents.listenerCount('destroyed')).toBe(1)
    expect(getActiveLiveSessionForTest()).toMatchObject({ ownerId: 8 })
  })

  it('has no connection-test handler, so nothing can open a session just to test', async () => {
    const { window } = liveWindow()
    await register(liveStore({}), window)
    expect(electron.handlers.has('jarvis:liveSessionTest')).toBe(false)
  })
})
