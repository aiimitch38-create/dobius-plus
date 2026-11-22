import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userData: '' }))

vi.mock('../ipc/ssh', () => ({ getSshConnectionManager: () => null }))
vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => mocks.userData }))

import { runSandboxedPostcheck } from './agent-run-postcheck-sandbox'

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

  it('denies getting at a .env file by renaming, linking or copying it', async () => {
    for (const command of [
      'mv .env readable.txt && cat readable.txt',
      'ln .env hard.txt && cat hard.txt',
      'ln -s .env soft.txt && cat soft.txt',
      'cp .env copy.txt && cat copy.txt',
      `${node} -e "const fs = require('fs'); fs.renameSync('.env', 'r.txt'); console.log(fs.readFileSync('r.txt', 'utf8'))"`
    ]) {
      const result = await check(command)
      expect(result.exitCode, command).not.toBe(0)
      expect(`${result.stdout}${result.stderr}`, command).not.toContain('ENV-SECRET')
    }
    expect(readFileSync(path.join(cwd, '.env'), 'utf8')).toBe('ENV-SECRET')
  })

  it('denies deleting or overwriting a .env file', async () => {
    expect((await check('rm .env')).exitCode).not.toBe(0)
    expect((await check('echo x > .env')).exitCode).not.toBe(0)
    expect(readFileSync(path.join(cwd, '.env'), 'utf8')).toBe('ENV-SECRET')
  })

  it.each([
    ['.claude/settings.json', 'mkdir -p .claude && echo x > .claude/settings.json'],
    ['.claude/settings.local.json', 'mkdir -p .claude; echo x > .claude/settings.local.json'],
    ['.claude/hooks', 'mkdir -p .claude/hooks && echo x > .claude/hooks/run.sh'],
    ['.mcp.json', 'echo x > .mcp.json'],
    ['.husky', 'mkdir .husky && echo x > .husky/pre-commit'],
    ['a nested .claude', 'mkdir -p pkg/.claude && echo x > pkg/.claude/settings.json'],
    ['a tree built in the temp folder', 'mkdir -p "$TMPDIR/e/.claude" && mv "$TMPDIR/e/.claude" .claude']
  ])('denies planting %s', async (target, command) => {
    const result = await check(command)
    expect(result.exitCode).not.toBe(0)
    const name = target.startsWith('.') ? target.split('/')[0] : '.claude'
    expect(existsSync(path.join(cwd, name))).toBe(false)
    expect(existsSync(path.join(cwd, 'pkg', '.claude'))).toBe(false)
  })

  it('denies moving a prepared folder or file onto a protected name', async () => {
    const dir = await check('mkdir staged && echo x > staged/settings.json && mv staged .claude')
    expect(dir.exitCode).not.toBe(0)
    expect(existsSync(path.join(cwd, '.claude'))).toBe(false)
    const file = await check('echo x > staged.json && mv staged.json .mcp.json')
    expect(file.exitCode).not.toBe(0)
    expect(existsSync(path.join(cwd, '.mcp.json'))).toBe(false)
  })

  it('denies writing git hooks or config and replacing the .git folder', async () => {
    mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true })
    writeFileSync(path.join(cwd, '.git', 'config'), 'ORIGINAL')
    for (const command of [
      'echo x > .git/hooks/pre-commit',
      'echo x >> .git/config',
      'mv .git .git-old',
      'rm -rf .git/hooks',
      'mv .git/hooks .git/hooks-old'
    ]) {
      expect((await check(command)).exitCode, command).not.toBe(0)
    }
    expect(existsSync(path.join(cwd, '.git', 'hooks', 'pre-commit'))).toBe(false)
    expect(existsSync(path.join(cwd, '.git-old'))).toBe(false)
    expect(readFileSync(path.join(cwd, '.git', 'config'), 'utf8')).toBe('ORIGINAL')
  })

  it('denies a sign-in folder that is a symlink, under both of its names', async () => {
    const realAws = path.join(root, 'vault', 'aws')
    mkdirSync(realAws, { recursive: true })
    writeFileSync(path.join(realAws, 'credentials'), 'LINKED-AWS-SECRET')
    rmSync(path.join(home, '.aws'), { recursive: true })
    symlinkSync(realAws, path.join(home, '.aws'))

    for (const command of [
      'cat "$HOME/.aws/credentials"',
      `cat ${JSON.stringify(path.join(realAws, 'credentials'))}`,
      `ls ${JSON.stringify(realAws)}`
    ]) {
      const result = await check(command)
      expect(result.exitCode, command).not.toBe(0)
      expect(`${result.stdout}${result.stderr}`, command).not.toContain('LINKED-AWS-SECRET')
      expect(result.stdout, command).not.toContain('credentials')
    }
  })

  it('denies the real file behind a .env symlink in the project', async () => {
    mkdirSync(path.join(cwd, 'conf'))
    writeFileSync(path.join(cwd, 'conf', 'plain-name.txt'), 'LINKED-ENV-SECRET')
    symlinkSync(path.join(cwd, 'conf', 'plain-name.txt'), path.join(cwd, '.env.production'))

    for (const command of [
      'cat .env.production',
      'cat conf/plain-name.txt',
      'mv conf conf2 && cat conf2/plain-name.txt',
      'mv conf/plain-name.txt out.txt && cat out.txt'
    ]) {
      const result = await check(command)
      expect(result.exitCode, command).not.toBe(0)
      expect(`${result.stdout}${result.stderr}`, command).not.toContain('LINKED-ENV-SECRET')
    }
  })

  it.each([
    ['home itself', () => home],
    ['inside a sign-in folder', () => path.join(home, '.config', 'proj')]
  ])('refuses to run at all when the run folder is %s', async (_label, folder) => {
    mkdirSync(folder(), { recursive: true })
    const outcome = await runSandboxedPostcheck({
      postcheck: { command: 'echo ran > ran.txt', timeoutSeconds: 20 },
      cwd: folder()
    })
    expect(outcome).toEqual({
      ok: false,
      reason: 'the run folder holds, or is inside, a protected sign-in folder'
    })
    expect(existsSync(path.join(folder(), 'ran.txt'))).toBe(false)
  })

  function isRunning(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      // No such process.
      return false
    }
  }

  it('stops a background process the check left in its process group', async () => {
    const outcome = await runSandboxedPostcheck({
      postcheck: { command: 'sleep 60 >/dev/null 2>&1 & echo $! > pid.txt', timeoutSeconds: 20 },
      cwd
    })
    expect(outcome).toMatchObject({ ok: true, processesLeft: false })
    const pid = Number(readFileSync(path.join(cwd, 'pid.txt'), 'utf8'))
    expect(pid).toBeGreaterThan(0)
    expect(isRunning(pid)).toBe(false)
  })

  it('removes its temp folder afterwards', async () => {
    const result = await check('echo "$TMPDIR"')
    expect(existsSync(result.stdout.trim())).toBe(false)
  })
})
