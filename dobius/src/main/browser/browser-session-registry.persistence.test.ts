import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RegistryModule from './browser-session-registry'

const USER_DATA = '/user-data'
const META_PATH = `${USER_DATA}/browser-session-meta.json`

type FsState = {
  files: Map<string, string>
  present: Set<string>
  mtimes: Map<string, number>
  tmpWrites: string[]
  failTmpWrite: boolean
  failRename: boolean
  readErrorCode: string | null
}

function fsKey(pathValue: string): string {
  return pathValue.replaceAll('\\', '/')
}

function createFsState(): FsState {
  return {
    files: new Map(),
    present: new Set(),
    mtimes: new Map(),
    tmpWrites: [],
    failTmpWrite: false,
    failRename: false,
    readErrorCode: null
  }
}

function seedMeta(fsState: FsState, meta: unknown): void {
  const raw = JSON.stringify(meta)
  fsState.files.set(META_PATH, raw)
  fsState.present.add(META_PATH)
}

function installModuleMocks(
  fsState: FsState,
  copyFailures: Set<string> = new Set()
): {
  sessionFromPartitionMock: ReturnType<typeof vi.fn>
  setupClientHintsOverrideMock: ReturnType<typeof vi.fn>
  browserManagerHandleGuestWillDownloadMock: ReturnType<typeof vi.fn>
  browserManagerNotifyPermissionDeniedMock: ReturnType<typeof vi.fn>
  requestSystemMediaAccessMock: ReturnType<typeof vi.fn>
} {
  const sessionFromPartitionMock = vi.fn((partition: string) => ({
    partition,
    setUserAgent: vi.fn(),
    getUserAgent: vi.fn(() => 'Mozilla/5.0 Electron/31 Dobius'),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined)
  }))
  const setupClientHintsOverrideMock = vi.fn()
  const browserManagerHandleGuestWillDownloadMock = vi.fn()
  const browserManagerNotifyPermissionDeniedMock = vi.fn()
  const requestSystemMediaAccessMock = vi.fn().mockResolvedValue(true)

  vi.doMock('electron', () => ({
    app: { getPath: vi.fn(() => USER_DATA) },
    session: { fromPartition: sessionFromPartitionMock },
    systemPreferences: {
      askForMediaAccess: vi.fn().mockResolvedValue(true),
      getMediaAccessStatus: vi.fn(() => 'granted')
    }
  }))

  vi.doMock('node:fs', () => ({
    constants: { COPYFILE_EXCL: 1 },
    copyFileSync: vi.fn((src: string, dst: string) => {
      const sourceKey = fsKey(src)
      const destinationKey = fsKey(dst)
      if (copyFailures.has(sourceKey)) {
        throw new Error(`copy fail for ${src}`)
      }
      fsState.present.add(destinationKey)
      const value = fsState.files.get(sourceKey)
      if (value !== undefined) {
        fsState.files.set(destinationKey, value)
      }
    }),
    existsSync: vi.fn((p: string) => fsState.present.has(fsKey(p))),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn((p: string) => {
      if (fsState.readErrorCode && fsKey(p) === META_PATH) {
        const code = fsState.readErrorCode
        throw Object.assign(new Error(`${code}: injected`), { code })
      }
      const v = fsState.files.get(fsKey(p))
      if (v === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return v
    }),
    readdirSync: vi.fn((dir: string) => {
      const prefix = `${fsKey(dir)}/`
      return [...fsState.present]
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map((key) => key.slice(prefix.length))
    }),
    statSync: vi.fn((p: string) => ({ mtimeMs: fsState.mtimes.get(fsKey(p)) ?? Date.now() })),
    renameSync: vi.fn((from: string, to: string) => {
      if (fsState.failRename) {
        throw Object.assign(new Error('EPERM: injected'), { code: 'EPERM' })
      }
      const sourceKey = fsKey(from)
      const destinationKey = fsKey(to)
      const v = fsState.files.get(sourceKey)
      if (v === undefined) {
        throw new Error('ENOENT')
      }
      fsState.files.set(destinationKey, v)
      fsState.present.add(destinationKey)
      fsState.files.delete(sourceKey)
      fsState.present.delete(sourceKey)
    }),
    unlinkSync: vi.fn((p: string) => {
      const key = fsKey(p)
      fsState.present.delete(key)
      fsState.files.delete(key)
    }),
    writeFileSync: vi.fn((p: string, data: string | Uint8Array) => {
      const value = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8')
      const key = fsKey(p)
      if (key.endsWith('.tmp')) {
        fsState.tmpWrites.push(key)
      }
      if (fsState.failTmpWrite && key.endsWith('.tmp')) {
        // Partial write: the temp exists with some bytes before the error.
        fsState.files.set(key, value.slice(0, 5))
        fsState.present.add(key)
        throw Object.assign(new Error('ENOSPC: injected'), { code: 'ENOSPC' })
      }
      fsState.files.set(key, value)
      fsState.present.add(key)
    })
  }))

  vi.doMock('./browser-manager', () => ({
    browserManager: {
      notifyPermissionDenied: browserManagerNotifyPermissionDeniedMock,
      handleGuestWillDownload: browserManagerHandleGuestWillDownloadMock
    }
  }))
  vi.doMock('./browser-media-access', () => ({
    hasSystemMediaAccess: vi.fn(() => true),
    requestSystemMediaAccess: requestSystemMediaAccessMock
  }))
  vi.doMock('./browser-session-ua', () => ({
    cleanElectronUserAgent: vi.fn((ua: string) => ua.replace(/\s*Electron\/\S+/, '')),
    setupClientHintsOverride: setupClientHintsOverrideMock
  }))

  return {
    sessionFromPartitionMock,
    setupClientHintsOverrideMock,
    browserManagerHandleGuestWillDownloadMock,
    browserManagerNotifyPermissionDeniedMock,
    requestSystemMediaAccessMock
  }
}

describe('BrowserSessionRegistry persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('migrates and consumes legacy pendingCookieDbPath into default partition replay', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      userAgent: null,
      pendingCookieDbPath: '/staged/legacy',
      profiles: []
    })
    fsState.present.add('/staged/legacy')

    installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.applyPendingCookieImport()

    const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
    expect(written.pendingCookieDbPath).toBeNull()
    expect(written.pendingCookieImports).toEqual({})
    expect(fsState.present.has('/user-data/Partitions/dobius-browser/Cookies')).toBe(true)
  })

  it('merges partition-keyed pending entries without clobbering unrelated entries', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      userAgent: null,
      userAgentByPartition: {},
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: []
    })

    installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.setPendingCookieImport('persist:dobius-browser', '/staged/default')
    browserSessionRegistry.setPendingCookieImport(
      'persist:dobius-browser-session-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '/staged/imported'
    )

    const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
    expect(written.pendingCookieDbPath).toBe('/staged/default')
    expect(written.pendingCookieImports).toEqual({
      'persist:dobius-browser': '/staged/default',
      'persist:dobius-browser-session-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': '/staged/imported'
    })
  })

  it('restores persisted UA for non-default partitions', async () => {
    const importedPartition = 'persist:dobius-browser-session-11111111-1111-4111-8111-111111111111'
    const importedUa = 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36'
    const defaultUa = 'Mozilla/5.0 Chrome/119.0.0.0 Safari/537.36'
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      userAgent: defaultUa,
      userAgentByPartition: {
        'persist:dobius-browser': defaultUa,
        [importedPartition]: importedUa
      },
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          scope: 'imported',
          partition: importedPartition,
          label: 'Imported',
          source: { browserFamily: 'comet', importedAt: 1 }
        }
      ]
    })

    const { sessionFromPartitionMock, setupClientHintsOverrideMock } = installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()

    const importedSessions = sessionFromPartitionMock.mock.results
      .filter((_, idx) => sessionFromPartitionMock.mock.calls[idx]?.[0] === importedPartition)
      .map((r) => r.value)
    expect(importedSessions.length).toBeGreaterThan(0)
    expect(
      importedSessions.some((s) =>
        s.setUserAgent.mock.calls.some((c: unknown[]) => c[0] === importedUa)
      )
    ).toBe(true)
    expect(
      setupClientHintsOverrideMock.mock.calls.some(
        (c: unknown[]) =>
          (c[0] as { partition?: string } | undefined)?.partition === importedPartition &&
          c[1] === importedUa
      )
    ).toBe(true)
  })

  it('sets up default-partition policies on restore', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      userAgent: null,
      userAgentByPartition: {},
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: []
    })

    const {
      sessionFromPartitionMock,
      browserManagerHandleGuestWillDownloadMock,
      browserManagerNotifyPermissionDeniedMock
    } = installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()

    const defaultSessions = sessionFromPartitionMock.mock.results
      .filter((_, idx) => sessionFromPartitionMock.mock.calls[idx]?.[0] === 'persist:dobius-browser')
      .map((r) => r.value)
    expect(defaultSessions.length).toBeGreaterThan(0)
    const defaultSession = defaultSessions[0]
    const requestHandler = defaultSession.setPermissionRequestHandler.mock.calls[0][0]
    const checkHandler = defaultSession.setPermissionCheckHandler.mock.calls[0][0]
    const guestWc = { id: 401, getURL: vi.fn(() => 'https://example.com/account') }
    const permissionCallback = vi.fn()

    requestHandler(guestWc, 'fullscreen', permissionCallback)
    requestHandler(guestWc, 'clipboard-read', permissionCallback)
    requestHandler(guestWc, 'clipboard-sanitized-write', permissionCallback)
    requestHandler(guestWc, 'notifications', permissionCallback)
    requestHandler(guestWc, 'persistent-storage', permissionCallback)
    requestHandler(guestWc, 'geolocation', permissionCallback)
    requestHandler(guestWc, 'media', permissionCallback, { mediaTypes: ['video'] })

    await vi.waitFor(() =>
      expect(permissionCallback.mock.calls).toEqual([
        [true],
        [true],
        [true],
        [true],
        [true],
        [false],
        [true]
      ])
    )
    expect(browserManagerNotifyPermissionDeniedMock).toHaveBeenCalledWith({
      guestWebContentsId: 401,
      permission: 'geolocation',
      rawUrl: 'https://example.com/account'
    })
    expect(
      browserManagerNotifyPermissionDeniedMock.mock.calls.map(([args]) => args.permission)
    ).toEqual(['geolocation'])
    expect(checkHandler(null, 'fullscreen', '')).toBe(true)
    expect(checkHandler(null, 'clipboard-read', '')).toBe(true)
    expect(checkHandler(null, 'clipboard-sanitized-write', '')).toBe(true)
    expect(checkHandler(null, 'notifications', '')).toBe(true)
    expect(checkHandler(null, 'persistent-storage', '')).toBe(true)
    expect(checkHandler(null, 'geolocation', '')).toBe(false)
    expect(checkHandler(null, 'media', '', { mediaType: 'video' })).toBe(true)
    expect(defaultSession.setDisplayMediaRequestHandler).toHaveBeenCalled()
    const displayMediaHandler = defaultSession.setDisplayMediaRequestHandler.mock.calls[0][0]
    const displayMediaCallback = vi.fn()
    displayMediaHandler(null, displayMediaCallback)
    expect(displayMediaCallback).toHaveBeenCalledWith({ video: undefined, audio: undefined })

    const devicePermissionHandler = defaultSession.setDevicePermissionHandler.mock.calls[0][0]
    expect(
      devicePermissionHandler({
        deviceType: 'hid',
        origin: 'https://github.com',
        device: { collections: [{ usagePage: 0xf1d0 }] }
      })
    ).toBe(true)
    expect(checkHandler(null, 'hid', '', { securityOrigin: 'https://github.com' })).toBe(true)

    const selectHidHandler = defaultSession.on.mock.calls.find(
      ([eventName]: unknown[]) => eventName === 'select-hid-device'
    )?.[1] as (
      event: { preventDefault: () => void },
      details: {
        deviceList: { deviceId: string; collections?: { usagePage?: number }[] }[]
        frame: { url: string }
      },
      callback: (deviceId?: string) => void
    ) => void
    const hidCallback = vi.fn()
    selectHidHandler(
      { preventDefault: vi.fn() },
      {
        frame: { url: 'https://github.com' },
        deviceList: [
          { deviceId: 'keyboard', collections: [{ usagePage: 1 }] },
          { deviceId: 'security-key', collections: [{ usagePage: 0xf1d0 }] }
        ]
      },
      hidCallback
    )
    expect(hidCallback).toHaveBeenCalledWith('security-key')

    const selectWebAuthnHandler = defaultSession.on.mock.calls.find(
      ([eventName]: unknown[]) => eventName === 'select-webauthn-account'
    )?.[1] as (
      event: { preventDefault: () => void },
      details: { accounts: { credentialId: string }[] },
      callback: (credentialId?: string | null) => void
    ) => void
    const webAuthnCallback = vi.fn()
    selectWebAuthnHandler(
      { preventDefault: vi.fn() },
      { accounts: [{ credentialId: 'credential-1' }] },
      webAuthnCallback
    )
    expect(webAuthnCallback).toHaveBeenCalledWith('credential-1')

    const willDownloadHandler = defaultSession.on.mock.calls.find(
      ([eventName]: unknown[]) => eventName === 'will-download'
    )?.[1] as (
      event: unknown,
      item: { getFilename: () => string },
      webContents: { id: number }
    ) => void
    expect(willDownloadHandler).toBeTypeOf('function')
    const item = { getFilename: vi.fn(() => 'report.pdf') }
    willDownloadHandler({}, item, { id: 402 })
    expect(browserManagerHandleGuestWillDownloadMock).toHaveBeenCalledWith({
      guestWebContentsId: 402,
      item
    })
  })

  it('does not stack default-partition policy handlers on repeated restore', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      userAgent: null,
      userAgentByPartition: {},
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: []
    })

    const { sessionFromPartitionMock } = installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()
    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()

    const defaultSessions = sessionFromPartitionMock.mock.results
      .filter((_, idx) => sessionFromPartitionMock.mock.calls[idx]?.[0] === 'persist:dobius-browser')
      .map((r) => r.value)
    const policySessions = defaultSessions.filter(
      (s) => s.setPermissionRequestHandler.mock.calls.length > 0
    )
    expect(policySessions).toHaveLength(1)
    expect(
      policySessions[0].on.mock.calls.filter(
        ([eventName]: unknown[]) => eventName === 'will-download'
      )
    ).toHaveLength(1)
    expect(
      policySessions[0].on.mock.calls.filter(
        ([eventName]: unknown[]) => eventName === 'select-hid-device'
      )
    ).toHaveLength(1)
    expect(
      policySessions[0].on.mock.calls.filter(
        ([eventName]: unknown[]) => eventName === 'select-webauthn-account'
      )
    ).toHaveLength(1)
  })

  it('notifies when default-partition media permission is denied', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      userAgent: null,
      userAgentByPartition: {},
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: []
    })

    const {
      sessionFromPartitionMock,
      browserManagerNotifyPermissionDeniedMock,
      requestSystemMediaAccessMock
    } = installModuleMocks(fsState)
    requestSystemMediaAccessMock.mockResolvedValue(false)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()

    const defaultSession = sessionFromPartitionMock.mock.results.find(
      (_, idx) => sessionFromPartitionMock.mock.calls[idx]?.[0] === 'persist:dobius-browser'
    )?.value
    const requestHandler = defaultSession.setPermissionRequestHandler.mock.calls[0][0]
    const guestWc = { id: 403, getURL: vi.fn(() => 'https://example.com/camera') }
    const callback = vi.fn()

    requestHandler(guestWc, 'media', callback, { mediaTypes: ['video'] })

    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false))
    expect(browserManagerNotifyPermissionDeniedMock).toHaveBeenCalledWith({
      guestWebContentsId: 403,
      permission: 'media',
      rawUrl: 'https://example.com/camera'
    })
  })

  it('keeps failed partition replay pending and removes unrelated missing entries', async () => {
    const importedPartition = 'persist:dobius-browser-session-22222222-2222-4222-8222-222222222222'
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      userAgent: null,
      userAgentByPartition: {},
      pendingCookieDbPath: null,
      pendingCookieImports: {
        [importedPartition]: '/staged/imported',
        'persist:dobius-browser': '/staged/missing'
      },
      profiles: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          scope: 'imported',
          partition: importedPartition,
          label: 'Imported',
          source: { browserFamily: 'comet', importedAt: 1 }
        }
      ]
    })
    fsState.present.add('/staged/imported')

    installModuleMocks(fsState, new Set(['/staged/imported']))
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.applyPendingCookieImport()

    const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
    expect(written.pendingCookieImports).toEqual({ [importedPartition]: '/staged/imported' })
    expect(written.pendingCookieDbPath).toBeNull()
  })

  it('ignores pending cookie imports for invalid persisted profile partitions', async () => {
    const invalidPartition = 'persist:../../outside'
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      userAgent: null,
      userAgentByPartition: {},
      pendingCookieDbPath: null,
      pendingCookieImports: {
        [invalidPartition]: '/staged/evil'
      },
      profiles: [
        {
          id: 'profile-1',
          scope: 'imported',
          partition: invalidPartition,
          label: 'Invalid',
          source: null
        }
      ]
    })
    fsState.present.add('/staged/evil')

    installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.applyPendingCookieImport()

    const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
    expect(written.pendingCookieImports).toEqual({})
    expect(fsState.present.has('/outside/Cookies')).toBe(false)
  })
})

describe('BrowserSessionRegistry metadata temp files (#51)', () => {
  const PROFILE_PARTITION = 'persist:dobius-browser-session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  function tmpKeys(fsState: FsState): string[] {
    return [...fsState.present].filter((key) => key.endsWith('.tmp'))
  }

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('gives every save its own temp name', async () => {
    const fsState = createFsState()
    seedMeta(fsState, { defaultSource: null, profiles: [] })
    installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.setPendingCookieImport('persist:dobius-browser', '/staged/a')
    browserSessionRegistry.persistUserAgent(PROFILE_PARTITION, 'UA/1')

    expect(fsState.tmpWrites).toHaveLength(2)
    expect(new Set(fsState.tmpWrites).size).toBe(2)
    expect(fsState.tmpWrites.every((key) => key !== `${META_PATH}.tmp`)).toBe(true)
    expect(tmpKeys(fsState)).toEqual([])
  })

  it.each([
    ['a write that fails midway', 'failTmpWrite'],
    ['a rename that fails', 'failRename']
  ] as const)('%s keeps valid metadata, leaves no temp, and reports it', async (_l, key) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      pendingCookieImports: { 'persist:dobius-browser': '/staged/keep' },
      profiles: []
    })
    const before = fsState.files.get(META_PATH)
    installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    fsState[key] = true
    browserSessionRegistry.persistUserAgent(PROFILE_PARTITION, 'UA/2')

    expect(fsState.files.get(META_PATH)).toBe(before)
    expect(tmpKeys(fsState)).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('browser-session-meta.json'),
      expect.anything()
    )
  })

  it("sweeps abandoned metadata temps at startup but keeps a live writer's temp", async () => {
    const fsState = createFsState()
    seedMeta(fsState, { defaultSource: null, profiles: [] })
    const old = Date.now() - 11 * 60_000
    const legacy = `${META_PATH}.tmp`
    const dead = `${META_PATH}.2147483646.0123456789ab.tmp`
    const live = `${META_PATH}.${process.ppid}.0123456789ab.tmp`
    const young = `${META_PATH}.2147483646.fedcba987654.tmp`
    for (const tmp of [legacy, dead, live, young]) {
      fsState.files.set(tmp, '')
      fsState.present.add(tmp)
      fsState.mtimes.set(tmp, tmp === young ? Date.now() - 1_000 : old)
    }
    installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()

    expect(tmpKeys(fsState).sort()).toEqual([live, young].sort())
  })
})

describe('BrowserSessionRegistry unreadable metadata', () => {
  const PROFILE = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    scope: 'imported',
    partition: 'persist:dobius-browser-session-cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    label: 'Work',
    source: null
  }

  function quarantineCopies(fsState: FsState): string[] {
    return [...fsState.present].filter((key) => key.startsWith(`${META_PATH}.unreadable-`))
  }

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it.each([
    ['malformed JSON', '{"profiles": [', null, true],
    ['wrong top-level shape', '[1,2]', null, true],
    ['EACCES on read', '{"profiles": []}', 'EACCES', false]
  ] as const)(
    '%s: every save is refused and the bytes stay unchanged',
    async (_l, raw, code, copied) => {
      const fsState = createFsState()
      fsState.files.set(META_PATH, raw)
      fsState.present.add(META_PATH)
      fsState.mtimes.set(META_PATH, 1)
      fsState.readErrorCode = code
      // An EACCES file cannot be copied either; quarantine is best-effort there.
      installModuleMocks(fsState, code ? new Set([META_PATH]) : new Set())
      const { browserSessionRegistry } = await import('./browser-session-registry')

      browserSessionRegistry.initializeBrowserSessionsFromPersistedState()
      browserSessionRegistry.applyPendingCookieImport()
      browserSessionRegistry.setPendingCookieImport('persist:dobius-browser', '/staged/x')
      browserSessionRegistry.persistUserAgent('persist:dobius-browser', 'UA/3')
      browserSessionRegistry.createProfile('isolated', 'New')

      expect(fsState.files.get(META_PATH)).toBe(raw)
      expect(fsState.tmpWrites).toEqual([])
      // Quarantine copy is kept once, not on every access.
      expect(quarantineCopies(fsState)).toHaveLength(copied ? 1 : 0)
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not saved'))
    }
  )

  it('a repaired file is read again on the next access and saves resume', async () => {
    const fsState = createFsState()
    fsState.files.set(META_PATH, '{"profiles": [')
    fsState.present.add(META_PATH)
    installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.persistUserAgent('persist:dobius-browser', 'UA/lost')
    expect(fsState.files.get(META_PATH)).toBe('{"profiles": [')

    seedMeta(fsState, { defaultSource: null, profiles: [PROFILE] })
    browserSessionRegistry.persistUserAgent('persist:dobius-browser', 'UA/4')

    const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
    expect(written.profiles).toEqual([PROFILE])
    expect(written.userAgentByPartition).toEqual({ 'persist:dobius-browser': 'UA/4' })
  })

  describe('file repaired mid-session after an unreadable start', () => {
    const A = { ...PROFILE, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'A' }
    const B = { ...PROFILE, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'B' }
    A.partition = `persist:dobius-browser-session-${A.id}`
    B.partition = `persist:dobius-browser-session-${B.id}`

    async function startUnreadableThenRepair(): Promise<{
      fsState: FsState
      registry: typeof RegistryModule.browserSessionRegistry
    }> {
      const fsState = createFsState()
      fsState.files.set(META_PATH, '{"profiles": [')
      fsState.present.add(META_PATH)
      fsState.mtimes.set(META_PATH, 1)
      installModuleMocks(fsState)
      const { browserSessionRegistry } = await import('./browser-session-registry')
      browserSessionRegistry.initializeBrowserSessionsFromPersistedState()
      expect(browserSessionRegistry.listProfiles().map((p) => p.id)).toEqual(['default'])
      seedMeta(fsState, {
        defaultSource: null,
        userAgentByPartition: { [A.partition]: 'UA/A' },
        profiles: [A, B]
      })
      return { fsState, registry: browserSessionRegistry }
    }

    function writtenProfileIds(fsState: FsState): string[] {
      const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
      return (written.profiles as { id: string }[]).map((p) => p.id).sort()
    }

    it('creating a profile keeps the repaired profiles', async () => {
      const { fsState, registry } = await startUnreadableThenRepair()
      const created = registry.createProfile('isolated', 'C')
      expect(writtenProfileIds(fsState)).toEqual([A.id, B.id, created!.id].sort())
      expect(registry.isAllowedPartition(A.partition)).toBe(true)
    })

    it('deleting a repaired profile removes only that one', async () => {
      const { fsState, registry } = await startUnreadableThenRepair()
      await expect(registry.deleteProfile(B.id)).resolves.toBe(true)
      expect(writtenProfileIds(fsState)).toEqual([A.id])
      expect(registry.isAllowedPartition(B.partition)).toBe(false)
    })

    it('persistUserAgent keeps the repaired profiles and UAs', async () => {
      const { fsState, registry } = await startUnreadableThenRepair()
      registry.persistUserAgent(B.partition, 'UA/B')
      const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
      expect(writtenProfileIds(fsState)).toEqual([A.id, B.id])
      expect(written.userAgentByPartition).toEqual({ [A.partition]: 'UA/A', [B.partition]: 'UA/B' })
    })
  })

  it('a missing file is a normal first run: saves create it', async () => {
    const fsState = createFsState()
    installModuleMocks(fsState)
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.persistUserAgent('persist:dobius-browser', 'UA/5')

    const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
    expect(written.userAgent).toBe('UA/5')
    expect(quarantineCopies(fsState)).toEqual([])
  })
})
