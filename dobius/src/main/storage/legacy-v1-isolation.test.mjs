// Bug #52: the legacy V1 app (repo-root electron/) and V2 share one userData
// dir. These fixtures launch both against one temp dir and check that neither
// overwrites the other's files. A .mjs file because the V1 code is plain JS
// outside the TypeScript project.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ userData: '', temp: '', setPath: null }))

vi.mock('electron', () => ({
  app: {
    getPath: (name) => (name === 'temp' ? electronMock.temp : electronMock.userData),
    setPath: (name, value) => electronMock.setPath(name, value)
  }
}))

vi.mock('../asana/asana-token-store', () => ({
  hasAsanaToken: () => true,
  setAsanaToken: vi.fn()
}))

vi.mock('../asana/asana-config', async () => {
  const { DEFAULT_ASANA_CONFIG } = await import('../../shared/asana')
  return { getAsanaConfig: () => DEFAULT_ASANA_CONFIG, updateAsanaConfig: vi.fn() }
})

vi.mock('../ipc/repos', () => ({ addLocalRepoFromPath: vi.fn() }))

// Absolute paths: the V1 tree sits outside the vitest root, where a relative
// dynamic import resolves against the root instead of this file.
const V1_DIR = fileURLToPath(new URL('../../../../electron/', import.meta.url))
const V1_GUARD = path.join(V1_DIR, 'v2-writer-guard.js')
const V1_CONFIG = path.join(V1_DIR, 'config-manager.js')

const V1_CONFIG_JSON = `${JSON.stringify({
  projects: {
    '/legacy/project': {
      checkpoints: [{ id: 'cp-1', label: 'V1 checkpoint' }],
      tabs: [{ id: 'tab-2' }],
      // Inline scrollback: loadConfig's one-time migration would move it out.
      terminalStates: { 'tab-2': { scrollback: ['inline v1 scrollback'] } }
    }
  },
  asanaQueue: { myGid: '1234567' }
})}\n`

let shared
let redirected

// Every file under dir → its bytes and mtime, so any write shows up.
function snapshot(dir) {
  const out = {}
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        out[path.relative(dir, full)] = `${readFileSync(full, 'utf8')}@${statSync(full).mtimeMs}`
      }
    }
  }
  walk(dir)
  return out
}

function seedV1Files() {
  writeFileSync(path.join(shared, 'config.json'), V1_CONFIG_JSON)
  const tabDir = path.join(shared, 'terminal-history', 'L2xlZ2FjeS9wcm9qZWN0')
  mkdirSync(tabDir, { recursive: true })
  writeFileSync(path.join(tabDir, 'tab-1.scrollback.json'), '{"lines":["v1"]}')
}

async function launchV2() {
  const { claimV2WriterMarker } = await import('./v2-writer-marker')
  const { migrateLegacyDobiusConfig } = await import('../migrate-legacy-dobius-config')
  const claim = claimV2WriterMarker('2.0.0-test', shared)
  await migrateLegacyDobiusConfig({ getRepoCount: () => 1, updateRepo: vi.fn() })
  return claim
}

async function launchV1() {
  const guard = await import(V1_GUARD)
  const config = await import(V1_CONFIG)
  return { guard, config }
}

// A V1 session doing its normal writes: load (scrollback migration), a
// checkpoint, the debounced async save, scrollback, then the quit flush.
async function runV1Session(config) {
  const cfg = config.loadConfig()
  config.setProjectConfig('/legacy/project', {
    checkpoints: [{ id: 'cp-2', label: 'written by V1 after V2 claimed the folder' }]
  })
  await new Promise((resolve) => setTimeout(resolve, 600))
  config.saveConfig(cfg)
  await config.saveTerminalScrollback('/legacy/project', 'tab-1', { lines: ['overwritten'] })
  await config.flushConfigAsync()
}

describe('legacy V1 / V2 data isolation (bug #52)', () => {
  beforeEach(() => {
    vi.resetModules()
    shared = mkdtempSync(path.join(tmpdir(), 'dobius-shared-userdata-'))
    electronMock.temp = mkdtempSync(path.join(tmpdir(), 'dobius-temp-'))
    redirected = null
    electronMock.userData = shared
    electronMock.setPath = (name, value) => {
      if (name === 'userData') {
        redirected = value
        electronMock.userData = value
      }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('V1 and V2 name the same marker file', async () => {
    const { V2_WRITER_MARKER_FILE: v2Name } = await import('./v2-writer-marker')
    const { V2_WRITER_MARKER_FILE: v1Name } = await import(V1_GUARD)
    expect(v1Name).toBe(v2Name)
  })

  it('V2 launch claims the dir without touching V1 files, and never rewrites its marker', async () => {
    seedV1Files()
    const before = snapshot(shared)
    expect(await launchV2()).toBe('created')
    const after = snapshot(shared)
    for (const [file, content] of Object.entries(before)) {
      expect(after[file]).toBe(content)
    }
    expect(Object.keys(after)).toContain('dobius-v2-writer.json')

    const marker = after['dobius-v2-writer.json']
    vi.resetModules()
    expect(await launchV2()).toBe('present')
    expect(snapshot(shared)['dobius-v2-writer.json']).toBe(marker)
  })

  it('V1 launched after V2 refuses: shared dir unchanged, userData redirected, no writes anywhere', async () => {
    seedV1Files()
    await launchV2()
    const before = snapshot(shared)
    const { guard, config } = await launchV1()

    expect(guard.v1RefusedAtStartup).toBe(true)
    expect(redirected).toBe(path.join(electronMock.temp, 'dobius-v1-refused'))
    await runV1Session(config)

    expect(snapshot(shared)).toEqual(before)
    expect(snapshot(electronMock.temp)).toEqual({})
  })

  it('V1 already running stops writing once V2 claims the dir', async () => {
    seedV1Files()
    const { guard, config } = await launchV1()
    expect(guard.v1RefusedAtStartup).toBe(false)
    expect(redirected).toBeNull()

    // Control: before V2 exists, V1 writes normally.
    await config.saveTerminalScrollback('/legacy/project', 'tab-1', { lines: ['v1 write ok'] })
    const scrollback = path.join(shared, 'terminal-history', 'L2xlZ2FjeS9wcm9qZWN0', 'tab-1.scrollback.json')
    expect(readFileSync(scrollback, 'utf8')).toContain('v1 write ok')

    await launchV2()
    const before = snapshot(shared)
    await runV1Session(config)
    expect(snapshot(shared)).toEqual(before)
  })

  it('V1 main.js loads the guard before any other V1 module and exits before any setup', () => {
    const main = readFileSync(path.join(V1_DIR, 'main.js'), 'utf8')
    const localImports = [...main.matchAll(/^import [^;]*?from '(\.\/[^']+)';/gms)].map((m) => m[1])
    expect(localImports[0]).toBe('./v2-writer-guard.js')
    const ready = main.slice(main.indexOf('app.whenReady().then(() => {'))
    expect(ready.indexOf('if (v1RefusedAtStartup)')).toBeGreaterThan(0)
    expect(ready.indexOf('app.exit(0);')).toBeLessThan(ready.indexOf('setupCrashLogging();'))
  })

  it('V2 migration reads the V1 config from the captured root, not a moved live path', async () => {
    seedV1Files()
    const { captureUserDataRoot } = await import('./user-data-root')
    captureUserDataRoot()
    const late = mkdtempSync(path.join(tmpdir(), 'dobius-late-userdata-'))
    electronMock.userData = late
    const { migrateLegacyDobiusConfig } = await import('../migrate-legacy-dobius-config')
    await migrateLegacyDobiusConfig({ getRepoCount: () => 1, updateRepo: vi.fn() })
    expect(Object.keys(snapshot(shared))).toContain('legacy-config-migrated.json')
    expect(snapshot(late)).toEqual({})
  })

  it('treats an unreadable marker location as present (fails closed)', async () => {
    const { hasV2WriterMarker } = await import(V1_GUARD)
    const notADir = path.join(shared, 'plain-file')
    writeFileSync(notADir, 'x')
    expect(hasV2WriterMarker(shared)).toBe(false)
    expect(hasV2WriterMarker(notADir)).toBe(true)
  })
})
