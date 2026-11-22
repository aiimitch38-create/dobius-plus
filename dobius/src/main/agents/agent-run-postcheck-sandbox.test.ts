import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userData: '' }))

vi.mock('../ipc/ssh', () => ({ getSshConnectionManager: () => null }))
vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => mocks.userData }))

import { buildPostcheckSandboxProfile, runSandboxedPostcheck } from './agent-run-postcheck-sandbox'

const node = JSON.stringify(process.execPath)

// Real sandbox-exec, real processes. A fake HOME stands in for the user's, so
// the "secrets" these checks try to read and the escapes they try are harmless.
describe.skipIf(process.platform !== 'darwin')('runSandboxedPostcheck (real sandbox-exec)', () => {
  let root = ''
  let home = ''
  let cwd = ''
  let outside = ''
  let realHome: string | undefined

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dobius-postcheck-sandbox-')))
    home = path.join(root, 'home')
    cwd = path.join(home, 'project')
    outside = path.join(root, 'outside')
    mocks.userData = path.join(home, 'Library', 'Application Support', 'dobius-plus')
    for (const dir of [cwd, outside, mocks.userData, path.join(home, '.ssh'), path.join(home, '.aws'),
      path.join(home, '.config'), path.join(home, '.claude'), path.join(home, '.codex'),
      path.join(home, 'Library', 'Keychains')]) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path.join(home, '.ssh', 'id_ed25519'), 'PRIVATE-KEY')
    writeFileSync(path.join(home, '.aws', 'credentials'), 'AWS-SECRET')
    writeFileSync(path.join(home, '.config', 'token'), 'CONFIG-SECRET')
    writeFileSync(path.join(home, '.claude', '.credentials.json'), 'CLAUDE-SECRET')
    writeFileSync(path.join(home, '.codex', 'auth.json'), 'CODEX-SECRET')
    writeFileSync(path.join(home, 'Library', 'Keychains', 'login.keychain-db'), 'KEYCHAIN')
    writeFileSync(path.join(mocks.userData, 'dobius-runtime.json'), 'RUNTIME-TOKEN')
    writeFileSync(path.join(cwd, '.env'), 'ENV-SECRET')
    writeFileSync(path.join(cwd, '.env.local'), 'ENV-LOCAL-SECRET')
    writeFileSync(path.join(cwd, 'readme.txt'), 'plain file')
    realHome = process.env.HOME
    process.env.HOME = home
  })

  afterEach(() => {
    process.env.HOME = realHome
    rmSync(root, { recursive: true, force: true })
  })

  async function check(command: string) {
    const outcome = await runSandboxedPostcheck({ postcheck: { command, timeoutSeconds: 20 }, cwd })
    if (!outcome.ok) {
      throw new Error(`sandbox did not start: ${outcome.reason}`)
    }
    return outcome.result
  }

  it('lets a passing and a failing check behave normally', async () => {
    const pass = await check('true')
    expect(pass).toMatchObject({ command: 'true', exitCode: 0, timedOut: false, error: null })
    expect((await check('exit 1')).exitCode).toBe(1)
    expect((await check('exit 7')).exitCode).toBe(7)
  })

  it('lets the check read the project, write inside it and use its temp folder', async () => {
    const result = await check(
      'cat readme.txt && echo built > out.txt && cat out.txt && echo t > "$TMPDIR/t.txt" && cat "$TMPDIR/t.txt"'
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('plain file')
    expect(result.stdout).toContain('built')
    expect(existsSync(path.join(cwd, 'out.txt'))).toBe(true)
  })

  it('runs a real program (node) inside the sandbox', async () => {
    const result = await check(`${node} -e "console.log(6 * 7)"`)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('42')
  })

  it.each([
    ['~/.ssh', 'cat "$HOME/.ssh/id_ed25519"', 'PRIVATE-KEY'],
    ['~/.aws', 'cat "$HOME/.aws/credentials"', 'AWS-SECRET'],
    ['~/.config', 'cat "$HOME/.config/token"', 'CONFIG-SECRET'],
    ['~/.claude', 'cat "$HOME/.claude/.credentials.json"', 'CLAUDE-SECRET'],
    ['~/.codex', 'cat "$HOME/.codex/auth.json"', 'CODEX-SECRET'],
    ['the keychain folder', 'cat "$HOME/Library/Keychains/login.keychain-db"', 'KEYCHAIN'],
    ['the runtime token file', 'cat "$HOME/Library/Application Support/dobius-plus/dobius-runtime.json"', 'RUNTIME-TOKEN'],
    ['.env', 'cat .env', 'ENV-SECRET'],
    ['.env.local', 'cat .env.local', 'ENV-LOCAL-SECRET'],
    ['a listing of ~/.ssh', 'ls "$HOME/.ssh"', 'id_ed25519']
  ])('denies reading %s', async (_label, command, secret) => {
    const result = await check(command)
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret)
  })

  it('denies writing to home and anywhere else outside the project', async () => {
    const inHome = await check('echo x > "$HOME/escaped.txt"')
    expect(inHome.exitCode).not.toBe(0)
    expect(existsSync(path.join(home, 'escaped.txt'))).toBe(false)

    const elsewhere = await check(`echo x > ${JSON.stringify(path.join(outside, 'escaped.txt'))}`)
    expect(elsewhere.exitCode).not.toBe(0)
    expect(existsSync(path.join(outside, 'escaped.txt'))).toBe(false)

    const overSecret = await check('echo x >> "$HOME/.ssh/authorized_keys"')
    expect(overSecret.exitCode).not.toBe(0)
    expect(existsSync(path.join(home, '.ssh', 'authorized_keys'))).toBe(false)
  })

  it('denies the network: a local TCP server and curl are both unreachable', async () => {
    const server = net.createServer((socket) => socket.end('hello'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as net.AddressInfo
    try {
      const script = `require('net').connect(${port}, '127.0.0.1').on('connect', () => process.exit(0)).on('error', (e) => { console.log(e.code); process.exit(3) })`
      const tcp = await check(`${node} -e ${JSON.stringify(script)}`)
      expect(tcp.exitCode).toBe(3)
      const curl = await check(`curl -sS -m 5 http://127.0.0.1:${port}/`)
      expect(curl.exitCode).not.toBe(0)
      expect(curl.stdout).not.toContain('hello')
    } finally {
      server.close()
    }
  })

  it('denies unix sockets', async () => {
    const socketPath = path.join(outside, 's.sock')
    const server = net.createServer((socket) => socket.end('hello'))
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    try {
      const script = `require('net').connect(${JSON.stringify(socketPath)}).on('connect', () => process.exit(0)).on('error', (e) => { console.log(e.code); process.exit(3) })`
      const result = await check(`${node} -e ${JSON.stringify(script)}`)
      expect(result.exitCode).toBe(3)
    } finally {
      server.close()
    }
  })

  it('passes only the allow-listed environment, with its own temp folder', async () => {
    process.env.GITHUB_TOKEN = 'ghp-test'
    try {
      const result = await check('env')
      expect(result.stdout).not.toContain('GITHUB_TOKEN')
      expect(result.stdout).toMatch(/^TMPDIR=.*dobius-postcheck-/m)
      expect(result.stdout).toContain(`HOME=${home}`)
    } finally {
      delete process.env.GITHUB_TOKEN
    }
  })

  it('removes its temp folder afterwards', async () => {
    const result = await check('echo "$TMPDIR"')
    expect(existsSync(result.stdout.trim())).toBe(false)
  })
})

describe('buildPostcheckSandboxProfile', () => {
  const base = { tempDir: '/private/tmp/t', homeDir: '/Users/me', userDataDir: '/Users/me/Library/Application Support/dobius-plus' }

  it('denies by default, denies the network and writes only to the run folder and temp folder', () => {
    const profile = buildPostcheckSandboxProfile({ ...base, cwd: '/Users/me/Projects (Code)/app' })
    expect(profile).toContain('(deny default)')
    expect(profile).toContain('(deny network*)')
    expect(profile).toContain(
      '(allow file-write* (subpath "/Users/me/Projects (Code)/app") (subpath "/private/tmp/t"))'
    )
    expect(profile).toContain('(subpath "/Users/me/.ssh")')
    expect(profile).toContain('(subpath "/Users/me/Library/Application Support/dobius-plus")')
    expect(profile).not.toMatch(/allow network|allow default|allow mach-lookup\)/)
  })

  it('keeps a run folder inside a denied folder readable', () => {
    const profile = buildPostcheckSandboxProfile({ ...base, cwd: '/Users/me/.dobius/agents/a1/work' })
    expect(profile).toContain('(allow file-read* (subpath "/Users/me/.dobius/agents/a1/work"))')
  })

  it('does not re-open the secrets when the run folder is home itself', () => {
    const profile = buildPostcheckSandboxProfile({ ...base, cwd: '/Users/me' })
    expect(profile).not.toContain('(allow file-read* (subpath "/Users/me"))')
  })

  it('escapes quotes in paths', () => {
    const profile = buildPostcheckSandboxProfile({ ...base, cwd: '/Users/me/a"b' })
    expect(profile).toContain(String.raw`(subpath "/Users/me/a\"b")`)
  })
})
