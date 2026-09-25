import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('#9 leaves the Voice Conductor\'s real dobius-confirm alone', async () => {
    const { installDobiusClis } = await import('./install-clis')
    const bin = path.join(state.home, '.local', 'bin')
    installDobiusClis('/tmp/token')
    const confirm = path.join(bin, 'dobius-confirm')
    const conductorScript = '#!/bin/bash\n# dobius-conductor-cli v2\ncurl http://127.0.0.1:8422/confirm\n'
    writeFileSync(confirm, conductorScript, 'utf8')

    installDobiusClis('/tmp/token')

    expect(readFileSync(confirm, 'utf8')).toBe(conductorScript)
  })
})
