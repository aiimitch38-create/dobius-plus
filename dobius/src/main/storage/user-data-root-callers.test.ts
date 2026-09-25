import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable userData the electron mock resolves. Flipping it after capture stands
// in for app.setName() changing how app.getPath('userData') resolves (bug #53).
const electronMock = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronMock.userDataDir), isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}))

const MAIN_DIR = fileURLToPath(new URL('..', import.meta.url))

// Every remaining direct userData lookup in src/main, with the reason it may
// not go through getUserDataRoot(). Counts are exact so a new call in an
// allowlisted file still fails.
const ALLOWED_DIRECT_CALLS: Record<string, { count: number; why: string }> = {
  'storage/user-data-root.ts': {
    count: 3,
    why: 'the capture itself, the pre-capture fallback, and the divergence check'
  },
  'index.ts': {
    count: 2,
    why: 'pre-lock startup diagnostic logs the live value; mobile-pairing bridge reads the late path on purpose'
  }
}

const DIRECT_CALL = /\bgetPath\s*(?:\?\.)?\s*\(\s*(['"`])userData\1\s*\)/g

function isTestFile(rel: string): boolean {
  return /(^|\/)(__tests__|__mocks__)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      listSourceFiles(full, out)
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function countDirectCalls(source: string): number {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  return code.match(DIRECT_CALL)?.length ?? 0
}

describe('userData root guard (#53)', () => {
  it('src/main reads userData only through getUserDataRoot() outside the allowlist', () => {
    const found: Record<string, number> = {}
    for (const file of listSourceFiles(MAIN_DIR)) {
      const rel = path.relative(MAIN_DIR, file).split(path.sep).join('/')
      if (isTestFile(rel)) {
        continue
      }
      const count = countDirectCalls(readFileSync(file, 'utf8'))
      if (count > 0) {
        found[rel] = count
      }
    }
    const expected = Object.fromEntries(
      Object.entries(ALLOWED_DIRECT_CALLS).map(([rel, { count }]) => [rel, count])
    )
    expect(found).toEqual(expected)
  })

  it('the scanner catches the call shapes it guards against', () => {
    expect(countDirectCalls("join(app.getPath('userData'), 'x')")).toBe(1)
    expect(countDirectCalls('app?.getPath?.("userData")')).toBe(1)
    expect(countDirectCalls('electronApp.getPath( `userData` )')).toBe(1)
    expect(countDirectCalls("// app.getPath('userData') in a comment")).toBe(0)
    expect(countDirectCalls("app.getPath('logs')")).toBe(0)
  })
})

let root: string
let earlyDir: string
let lateDir: string

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'dobius-user-data-callers-'))
  earlyDir = path.join(root, 'dobius-plus')
  lateDir = path.join(root, 'Dobius+')
  mkdirSync(earlyDir, { recursive: true })
  mkdirSync(lateDir, { recursive: true })
  vi.resetModules()
  electronMock.userDataDir = earlyDir
  ;(await import('./user-data-root')).captureUserDataRoot()
  // After capture the live path moves, as app.setName('Dobius+') could make it.
  electronMock.userDataDir = lateDir
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('routed callers follow the captured root after the live path moves (#53)', () => {
  it.each([
    {
      name: 'claude managed accounts',
      resolve: async () =>
        (await import('../claude-accounts/managed-auth-path')).getClaudeManagedAccountsRoot()
    },
    {
      name: 'workstation repos',
      resolve: async () =>
        (await import('../communications/workstation/paths')).defaultWorkstationReposDir()
    },
    {
      name: 'scrcpy server jar',
      resolve: async () =>
        (await import('../emulator/android/scrcpy-server-download')).scrcpyServerJarPath()
    },
    {
      name: 'voice conductor CLI token',
      resolve: async () =>
        (await import('../voice-conductor/cli-install')).conductorCliServerAddress().tokenFile
    }
  ])('$name', async ({ resolve }) => {
    const resolved = await resolve()
    expect(resolved.startsWith(earlyDir + path.sep)).toBe(true)
  })

  it('prompts store writes under the captured root', async () => {
    ;(await import('../prompts/prompts-store')).savePrompt({ title: 't', text: 'x' })
    expect(readdirSync(earlyDir).length).toBeGreaterThan(0)
    expect(readdirSync(lateDir)).toEqual([])
  })

  it('DOBIUS_USER_DATA_PATH for CLI children is the captured root', async () => {
    const previous = process.env.DOBIUS_USER_DATA_PATH
    try {
      ;(await import('../startup/configure-process')).configureDobiusUserDataPathEnv()
      expect(process.env.DOBIUS_USER_DATA_PATH).toBe(earlyDir)
    } finally {
      if (previous === undefined) {
        delete process.env.DOBIUS_USER_DATA_PATH
      } else {
        process.env.DOBIUS_USER_DATA_PATH = previous
      }
    }
  })
})
