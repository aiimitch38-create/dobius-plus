import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Os from 'node:os'

const state = vi.hoisted(() => ({
  home: ''
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof Os>('node:os')
  return {
    ...actual,
    homedir: () => state.home
  }
})

describe('installDobiusClis', () => {
  beforeEach(() => {
    state.home = mkdtempSync(path.join(tmpdir(), 'dobius-cli-home-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('installs all eight wrappers with their bridge routes', async () => {
    const { installDobiusClis } = await import('./install-clis')
    installDobiusClis('/tmp/token')
    const routes = {
      'dobius-send': '/tabSend',
      'dobius-task-done': '/taskDone',
      'dobius-status': '/getStatus',
      'dobius-tabs': '/tabList',
      'dobius-send-to': '/tabSendTo',
      'dobius-focus': '/tabFocus',
      'dobius-read': '/tabRead',
      'dobius-open': '/tabOpen'
    }
    for (const [name, route] of Object.entries(routes)) {
      const file = path.join(state.home, '.local', 'bin', name)
      expect(readFileSync(file, 'utf8')).toContain(`http://127.0.0.1:8421${route}"`)
      if (process.platform !== 'win32') {
        expect(statSync(file).mode & 0o111).toBe(0o111)
      }
    }
  })

  it.skipIf(process.platform === 'win32')(
    'sends escaped arguments through the four new wrappers',
    async () => {
      const { installDobiusClis } = await import('./install-clis')
      const token = path.join(state.home, 'bridge-token')
      writeFileSync(token, 'test-token', 'utf8')
      installDobiusClis(token)
      const fakeBin = path.join(state.home, 'test-bin')
      mkdirSync(fakeBin)
      const curl = path.join(fakeBin, 'curl')
      writeFileSync(
        curl,
        '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n',
        'utf8'
      )
      chmodSync(curl, 0o755)
      const message = `quotes ' " and $HOME\nsecond line`
      const cases = [
        {
          name: 'dobius-send-to',
          args: ['term-1', message, 'last'],
          route: '/tabSendTo',
          body: { id: 'term-1', message: `${message} last` }
        },
        { name: 'dobius-focus', args: ['term-1'], route: '/tabFocus', body: { id: 'term-1' } },
        { name: 'dobius-read', args: ['term-1'], route: '/tabRead', body: { id: 'term-1' } },
        {
          name: 'dobius-read',
          args: ['term-1', '50'],
          route: '/tabRead',
          body: { id: 'term-1', limit: 50 }
        },
        {
          name: 'dobius-open',
          args: ["/tmp/Carson's project"],
          route: '/tabOpen',
          body: { project: "/tmp/Carson's project" }
        }
      ]
      for (const { name, args, route, body } of cases) {
        const script = path.join(state.home, '.local', 'bin', name)
        const output = execFileSync('bash', [script, ...args], {
          encoding: 'utf8',
          env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` }
        })
        const curlArgs = JSON.parse(output) as string[]
        expect(curlArgs).toContain(`http://127.0.0.1:8421${route}`)
        expect(curlArgs).toContain('Authorization: Bearer test-token')
        expect(JSON.parse(curlArgs[curlArgs.indexOf('--data-binary') + 1])).toEqual(body)
        expect(() => execFileSync('bash', [script], { stdio: 'pipe' })).toThrow()
      }
    }
  )

  it('replaces only stale legacy scripts that identify as Dobius-owned', async () => {
    const { installDobiusClis } = await import('./install-clis')
    const bin = path.join(state.home, '.local', 'bin')
    const owned = path.join(bin, 'dobius-reply')
    const userScript = path.join(bin, 'dobius-ask')
    installDobiusClis('/tmp/token')

    writeFileSync(owned, '#!/bin/bash\nTOKEN=voice-bridge-token\n', 'utf8')
    writeFileSync(userScript, '#!/bin/bash\necho user-owned\n', 'utf8')

    installDobiusClis('/tmp/token')

    expect(readFileSync(owned, 'utf8')).toContain('This Dobius+ command was retired')
    expect(readFileSync(userScript, 'utf8')).toBe('#!/bin/bash\necho user-owned\n')
    expect(readFileSync(path.join(bin, 'dobius-tabs'), 'utf8')).toContain('/tabList')
  })

  it('#9 retires a legacy dobius-confirm as an explicit denial', async () => {
    const { installDobiusClis } = await import('./install-clis')
    const bin = path.join(state.home, '.local', 'bin')
    installDobiusClis('/tmp/token')
    const confirm = path.join(bin, 'dobius-confirm')
    writeFileSync(confirm, '#!/bin/bash\ncurl http://127.0.0.1:8421/confirm\n', 'utf8')

    installDobiusClis('/tmp/token')

    const stub = readFileSync(confirm, 'utf8')
    expect(stub).toContain('DENIED')
    expect(stub).toContain('exit 1')
    expect(stub).not.toContain('This Dobius+ command was retired')
  })

  it('#9 upgrades its own earlier retired dobius-confirm stub to the denial', async () => {
    const { installDobiusClis } = await import('./install-clis')
    const bin = path.join(state.home, '.local', 'bin')
    installDobiusClis('/tmp/token')
    const confirm = path.join(bin, 'dobius-confirm')
    const oldStub =
      '#!/bin/bash\n# dobius-cli v1\necho "This Dobius+ command was retired in the new engine. See dobius --help / the Tasks panel." >&2\nexit 1\n'
    writeFileSync(confirm, oldStub, 'utf8')

    installDobiusClis('/tmp/token')

    expect(readFileSync(confirm, 'utf8')).toContain('DENIED')
  })

  it("#9 leaves the Voice Conductor's real dobius-confirm alone", async () => {
    const { installDobiusClis } = await import('./install-clis')
    const bin = path.join(state.home, '.local', 'bin')
    installDobiusClis('/tmp/token')
    const confirm = path.join(bin, 'dobius-confirm')
    const conductorScript =
      '#!/bin/bash\n# dobius-conductor-cli v2\ncurl http://127.0.0.1:8422/confirm\n'
    writeFileSync(confirm, conductorScript, 'utf8')

    installDobiusClis('/tmp/token')

    expect(readFileSync(confirm, 'utf8')).toBe(conductorScript)
  })
})

describe('installDobiusClis script ownership (X8)', () => {
  beforeEach(() => {
    state.home = mkdtempSync(path.join(tmpdir(), 'dobius-cli-home-'))
  })

  it('keeps the Voice Conductor copies of the shared script names', async () => {
    const { installDobiusClis } = await import('./install-clis')
    const bin = path.join(state.home, '.local', 'bin')
    installDobiusClis('/tmp/token')
    const conductorCopies = ['dobius-send', 'dobius-tabs', 'dobius-status'].map((name) => {
      const file = path.join(bin, name)
      const body = `#!/bin/bash\n# dobius-conductor-cli v2\n# ${name}\ncurl http://127.0.0.1:8422/x\n`
      writeFileSync(file, body, 'utf8')
      return { file, body }
    })

    installDobiusClis('/tmp/token')

    for (const { file, body } of conductorCopies) {
      expect(readFileSync(file, 'utf8')).toBe(body)
    }
    expect(readFileSync(path.join(bin, 'dobius-task-done'), 'utf8')).toContain('/taskDone')
  })

  it('never replaces a user script that shares a Dobius name', async () => {
    const { installDobiusClis } = await import('./install-clis')
    const bin = path.join(state.home, '.local', 'bin')
    installDobiusClis('/tmp/token')
    const file = path.join(bin, 'dobius-status')
    writeFileSync(file, '#!/bin/bash\necho mine\n', 'utf8')

    installDobiusClis('/tmp/token')

    expect(readFileSync(file, 'utf8')).toBe('#!/bin/bash\necho mine\n')
  })

  it('still upgrades its own earlier copies', async () => {
    const { installDobiusClis } = await import('./install-clis')
    const bin = path.join(state.home, '.local', 'bin')
    installDobiusClis('/tmp/token')
    const file = path.join(bin, 'dobius-send')
    writeFileSync(file, '#!/bin/bash\n# dobius-cli v0\nold body\n', 'utf8')

    installDobiusClis('/tmp/token')

    expect(readFileSync(file, 'utf8')).toContain('/tabSend')
  })
})
