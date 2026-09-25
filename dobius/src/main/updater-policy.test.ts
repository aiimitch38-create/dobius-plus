import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { appMock, autoUpdaterMock, disconnectState, isMock, killAllPtyMock, powerMonitorHandlers } =
  vi.hoisted(() => {
    const appEventHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
    const updaterEventHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
    const powerMonitorHandlers = new Map<string, ((...args: unknown[]) => void)[]>()

    const autoUpdaterMock = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        updaterEventHandlers.set(event, [...(updaterEventHandlers.get(event) ?? []), handler])
        return autoUpdaterMock
      }),
      emit: (event: string, ...args: unknown[]) => {
        for (const handler of updaterEventHandlers.get(event) ?? []) {
          handler(...args)
        }
      },
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      setFeedURL: vi.fn(),
      reset: () => {
        updaterEventHandlers.clear()
        autoUpdaterMock.on.mockClear()
        autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(null)
        autoUpdaterMock.downloadUpdate.mockReset().mockResolvedValue([])
        autoUpdaterMock.quitAndInstall.mockReset()
        autoUpdaterMock.setFeedURL.mockReset()
      }
    }

    const appMock = {
      isPackaged: true,
      getVersion: vi.fn(() => '1.0.51'),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        appEventHandlers.set(event, [...(appEventHandlers.get(event) ?? []), handler])
        return appMock
      }),
      emit: (event: string, ...args: unknown[]) => {
        for (const handler of appEventHandlers.get(event) ?? []) {
          handler(...args)
        }
      },
      resetHandlers: () => appEventHandlers.clear(),
      quit: vi.fn()
    }

    return {
      appMock,
      autoUpdaterMock,
      disconnectState: { value: true },
      isMock: { dev: false },
      killAllPtyMock: vi.fn(),
      powerMonitorHandlers
    }
  })

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  autoUpdater: { on: vi.fn() },
  powerMonitor: {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      powerMonitorHandlers.set(event, [...(powerMonitorHandlers.get(event) ?? []), handler])
    })
  },
  net: { fetch: vi.fn() }
}))
vi.mock('electron-updater', () => ({ autoUpdater: autoUpdaterMock }))
vi.mock('./electron-updater-loader', () => ({ loadElectronAutoUpdater: () => autoUpdaterMock }))
vi.mock('@electron-toolkit/utils', () => ({ is: isMock }))
vi.mock('./ipc/pty', () => ({ killAllPty: killAllPtyMock }))
vi.mock('./dobius-disconnect', () => ({
  get DOBIUS_SERVICES_DISCONNECTED() {
    return disconnectState.value
  }
}))
vi.mock('./updater-changelog', () => ({ fetchChangelog: vi.fn(async () => null) }))
vi.mock('./updater-nudge', () => ({
  fetchNudge: vi.fn(async () => null),
  shouldApplyNudge: vi.fn(() => false)
}))
vi.mock('./updater-prerelease-feed', () => ({
  fetchNewerReleaseTagsWithReadiness: vi.fn(async () => ({ tags: ['v1.0.61'], state: 'ready' })),
  getReleaseDownloadUrl: (tag: string) =>
    `https://github.com/statusdigitalmarketing/dobius-plus/releases/download/${tag}`
}))

const DAY_MS = 24 * 60 * 60 * 1000

type Combo = { name: string; flag: string | undefined; disconnected: boolean; allowed: boolean }

// The truth table: opt-in flag × disconnect switch. Only "opted in and not
// disconnected" may reach the update feed.
const COMBOS: Combo[] = [
  { name: 'opted in, connected', flag: '1', disconnected: false, allowed: true },
  { name: 'opted in, disconnected', flag: '1', disconnected: true, allowed: false },
  { name: 'not opted in, connected', flag: undefined, disconnected: false, allowed: false },
  { name: 'not opted in, disconnected', flag: undefined, disconnected: true, allowed: false }
]

function applyCombo(combo: Pick<Combo, 'flag' | 'disconnected'>): void {
  disconnectState.value = combo.disconnected
  vi.stubEnv('DOBIUS_ENABLE_DOBIUS_UPDATES', combo.flag)
}

function makeWindow(): { send: ReturnType<typeof vi.fn>; window: never } {
  const send = vi.fn()
  return { send, window: { webContents: { send } } as never }
}

function sentStatuses(send: ReturnType<typeof vi.fn>): { state: string }[] {
  return send.mock.calls
    .filter(([channel]) => channel === 'updater:status')
    .map(([, status]) => status as { state: string })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
  await new Promise((resolve) => setTimeout(resolve, 20))
}

function expectNeverUpToDate(send: ReturnType<typeof vi.fn>): void {
  expect(sentStatuses(send).map((s) => s.state)).not.toContain('not-available')
}

beforeEach(() => {
  vi.resetModules()
  vi.useRealTimers()
  autoUpdaterMock.reset()
  appMock.resetHandlers()
  appMock.on.mockClear()
  appMock.isPackaged = true
  isMock.dev = false
  powerMonitorHandlers.clear()
  killAllPtyMock.mockReset()
  disconnectState.value = true
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('resolveUpdatePolicy', () => {
  it.each(COMBOS)('$name → enabled=$allowed', async ({ flag, disconnected, allowed }) => {
    const { resolveUpdatePolicy } = await import('./updater-policy')
    const policy = resolveUpdatePolicy({
      disconnected,
      enableFlag: flag,
      isPackaged: true,
      isDev: false
    })
    expect(policy.enabled).toBe(allowed)
  })

  it('names why updates are off, disconnect first', async () => {
    const { resolveUpdatePolicy } = await import('./updater-policy')
    const base = { isPackaged: true, isDev: false }
    expect(resolveUpdatePolicy({ ...base, disconnected: true, enableFlag: '1' })).toEqual({
      enabled: false,
      reason: 'disconnected'
    })
    expect(resolveUpdatePolicy({ ...base, disconnected: false, enableFlag: '0' })).toEqual({
      enabled: false,
      reason: 'not-enabled'
    })
    expect(
      resolveUpdatePolicy({ disconnected: false, enableFlag: '1', isPackaged: false, isDev: false })
    ).toEqual({ enabled: false, reason: 'dev-build' })
    expect(
      resolveUpdatePolicy({ disconnected: false, enableFlag: '1', isPackaged: true, isDev: true })
    ).toEqual({ enabled: false, reason: 'dev-build' })
  })
})

describe('updater entry points follow the update policy (#106, #107)', () => {
  it.each(COMBOS)('startup: $name', async (combo) => {
    applyCombo(combo)
    const { send, window } = makeWindow()
    const { setupAutoUpdater } = await import('./updater')

    setupAutoUpdater(window, { getLastUpdateCheckAt: () => null })
    await settle()

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(combo.allowed ? 1 : 0)
    expect(autoUpdaterMock.setFeedURL.mock.calls.length > 0).toBe(combo.allowed)
    if (!combo.allowed) {
      expect(sentStatuses(send)).toEqual([
        expect.objectContaining({ state: 'disabled', userInitiated: undefined })
      ])
      expect(powerMonitorHandlers.size).toBe(0)
      expect(appMock.on).not.toHaveBeenCalledWith('browser-window-focus', expect.anything())
    }
  })

  it.each(COMBOS)('wake and focus: $name', async (combo) => {
    // Why: setup must succeed first so the listeners exist; the combo is then
    // applied live, which is what each entry point must re-check.
    applyCombo({ flag: '1', disconnected: false })
    let lastCheck: number | null = Date.now()
    const { send, window } = makeWindow()
    const { setupAutoUpdater } = await import('./updater')
    setupAutoUpdater(window, { getLastUpdateCheckAt: () => lastCheck })
    await settle()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    applyCombo(combo)
    send.mockClear()
    lastCheck = Date.now() - 2 * DAY_MS
    for (const handler of powerMonitorHandlers.get('resume') ?? []) {
      handler()
    }
    await settle()
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(combo.allowed ? 1 : 0)
    if (!combo.allowed) {
      appMock.emit('browser-window-focus')
      await settle()
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      expect(sentStatuses(send)).toContainEqual(expect.objectContaining({ state: 'disabled' }))
      expectNeverUpToDate(send)
    }
  })

  it.each(COMBOS)('24h timer: $name', async (combo) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'))
    applyCombo({ flag: '1', disconnected: false })
    const { send, window } = makeWindow()
    const { setupAutoUpdater } = await import('./updater')
    setupAutoUpdater(window, { getLastUpdateCheckAt: () => Date.now() - DAY_MS + 60_000 })
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    applyCombo(combo)
    await vi.advanceTimersByTimeAsync(61_000)

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(combo.allowed ? 1 : 0)
    if (!combo.allowed) {
      expectNeverUpToDate(send)
    }
  })

  it.each(COMBOS)('menu / Settings check: $name', async (combo) => {
    applyCombo(combo)
    const { send, window } = makeWindow()
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater(window, { getLastUpdateCheckAt: () => Date.now() })
    send.mockClear()

    checkForUpdatesFromMenu()
    await settle()

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(combo.allowed ? 1 : 0)
    if (!combo.allowed) {
      expect(sentStatuses(send)).toEqual([
        {
          state: 'disabled',
          reason: combo.disconnected ? 'disconnected' : 'not-enabled',
          userInitiated: true
        }
      ])
    }
  })

  it.each(COMBOS)('download: $name', async (combo) => {
    applyCombo({ flag: '1', disconnected: false })
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
      return Promise.resolve(undefined)
    })
    const { send, window } = makeWindow()
    const { setupAutoUpdater, checkForUpdatesFromMenu, downloadUpdate } = await import('./updater')
    setupAutoUpdater(window, { getLastUpdateCheckAt: () => Date.now() })
    checkForUpdatesFromMenu()
    await vi.waitFor(() => {
      expect(sentStatuses(send)).toContainEqual(
        expect.objectContaining({ state: 'available', version: '1.0.61' })
      )
    })

    applyCombo(combo)
    downloadUpdate()

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(combo.allowed ? 1 : 0)
  })

  it('install: quitAndInstall does nothing while updates are off', async () => {
    vi.useFakeTimers()
    applyCombo({ flag: '1', disconnected: true })
    const { quitAndInstall } = await import('./updater')

    quitAndInstall()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(killAllPtyMock).not.toHaveBeenCalled()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it.each(COMBOS.filter((combo) => !combo.allowed))(
    'getUpdateStatus reports disabled, never idle or up to date: $name',
    async (combo) => {
      applyCombo(combo)
      const { getUpdateStatus } = await import('./updater')
      expect(getUpdateStatus()).toEqual({
        state: 'disabled',
        reason: combo.disconnected ? 'disconnected' : 'not-enabled',
        userInitiated: undefined
      })
    }
  )

  it('dev builds report disabled instead of up to date on a manual check', async () => {
    applyCombo({ flag: '1', disconnected: false })
    isMock.dev = true
    const { send, window } = makeWindow()
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater(window)
    checkForUpdatesFromMenu()

    expect(sentStatuses(send)).toContainEqual({
      state: 'disabled',
      reason: 'dev-build',
      userInitiated: true
    })
    expectNeverUpToDate(send)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('update target (#111)', () => {
  const configDir = join(import.meta.dirname, '../../config')

  it('has no dead dev-app-update.yml pointing at another repository', () => {
    expect(existsSync(join(configDir, 'dev-app-update.yml'))).toBe(false)
  })

  it('points the runtime feed at the same repository electron-builder publishes to', () => {
    const require = createRequire(import.meta.url)
    const builderConfig = require(join(configDir, 'electron-builder.config.cjs')) as {
      publish: { owner: string; repo: string }
    }
    const updaterSource = readFileSync(join(import.meta.dirname, 'updater.ts'), 'utf8')
    const { owner, repo } = builderConfig.publish
    expect(updaterSource).toContain(`https://github.com/${owner}/${repo}/releases/latest/download`)
  })
})
