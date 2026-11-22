import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../storage/user-data-root', () => ({
  getUserDataRoot: () => '/nonexistent-dobius-user-data'
}))

import {
  assertAgentReadAllowed,
  assertAgentRelativePath,
  assertAgentWriteAllowed,
  isSecretLookingPath
} from './agent-file-guard'

let base: string
let root: string
let outside: string

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-file-guard-')))
  root = join(base, 'wt')
  outside = join(base, 'other')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(root, 'src', 'app.ts'), 'ok')
  writeFileSync(join(root, '.env'), 'SECRET=1')
  writeFileSync(join(outside, 'notes.txt'), 'other worktree')
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('isSecretLookingPath', () => {
  it.each([
    '.env',
    '.env.local',
    'config/.ENV.production',
    'api-key.txt',
    'secrets.json',
    'aws_credentials',
    'github-token',
    'dobius-runtime.json',
    'dobius-runtime-dev.json',
    'certs/server.pem',
    'id_ed25519',
    'home/.ssh/config',
    // Why: APFS folds the long s to "s", so this opens a secrets file.
    'ſecret.txt'
  ])('refuses %s', (path) => {
    expect(isSecretLookingPath(path)).toBe(true)
  })

  it.each(['src/app.ts', 'README.md', 'docs/environment.md'])('allows %s', (path) => {
    expect(isSecretLookingPath(path)).toBe(false)
  })
})

describe('assertAgentRelativePath', () => {
  it.each(['/etc/passwd', '../other/notes.txt', 'src/../../x', 'src//a', './a', 'C:/x', ''])(
    'refuses %s',
    (path) => {
      expect(() => assertAgentRelativePath(path)).toThrow(/file access refused/)
    }
  )
})

describe('assertAgentReadAllowed', () => {
  it('allows a normal file inside the worktree', async () => {
    await expect(
      assertAgentReadAllowed({ worktreeRoot: root, relativePath: 'src/app.ts' })
    ).resolves.toBeUndefined()
  })

  it('refuses .env and a symlink that leads out of the worktree or onto a secret', async () => {
    symlinkSync(join(outside, 'notes.txt'), join(root, 'src', 'escape.txt'))
    symlinkSync(join(root, '.env'), join(root, 'src', 'innocent.txt'))
    symlinkSync(outside, join(root, 'linked-dir'))
    await expect(assertAgentReadAllowed({ worktreeRoot: root, relativePath: '.env' })).rejects.toThrow(
      /secret-looking/
    )
    await expect(
      assertAgentReadAllowed({ worktreeRoot: root, relativePath: 'src/escape.txt' })
    ).rejects.toThrow(/outside the worktree/)
    await expect(
      assertAgentReadAllowed({ worktreeRoot: root, relativePath: 'linked-dir/notes.txt' })
    ).rejects.toThrow(/outside the worktree/)
    await expect(
      assertAgentReadAllowed({ worktreeRoot: root, relativePath: 'src/innocent.txt' })
    ).rejects.toThrow(/secret-looking/)
  })

  it('refuses remote (SSH) worktrees: no remote realpath, so symlinks could not be checked', async () => {
    await expect(
      assertAgentReadAllowed({ worktreeRoot: '/remote/wt', relativePath: 'a.ts', connectionId: 'c' })
    ).rejects.toThrow(/isn't available for remote worktrees yet/)
    await expect(
      assertAgentWriteAllowed({ worktreeRoot: '/remote/wt', relativePath: 'a.ts', connectionId: 'c' }, [])
    ).rejects.toThrow(/isn't available for remote worktrees yet/)
  })
})

describe('assertAgentWriteAllowed', () => {
  it('allows a new or existing file inside the worktree', async () => {
    await expect(
      assertAgentWriteAllowed({ worktreeRoot: root, relativePath: 'src/new/file.ts' }, [])
    ).resolves.toBeUndefined()
    await expect(
      assertAgentWriteAllowed({ worktreeRoot: root, relativePath: 'src/app.ts' }, [])
    ).resolves.toBeUndefined()
  })

  it('refuses .., secrets, dot-files, agent instructions and symlink escapes', async () => {
    symlinkSync(outside, join(root, 'linked-dir'))
    symlinkSync(join(outside, 'notes.txt'), join(root, 'src', 'escape.txt'))
    for (const relativePath of [
      '../other/notes.txt',
      '.env.local',
      'config/api-key.json',
      '.git/hooks/pre-commit',
      'CLAUDE.md',
      'package.json',
      'linked-dir/notes.txt',
      'src/escape.txt'
    ]) {
      await expect(
        assertAgentWriteAllowed({ worktreeRoot: root, relativePath }, [])
      ).rejects.toThrow(/file access refused/)
    }
  })

  it('refuses a write into Dobius data even inside the worktree', async () => {
    await expect(
      assertAgentWriteAllowed({ worktreeRoot: root, relativePath: 'src/x.ts' }, [join(root, 'src')])
    ).rejects.toThrow(/inside Dobius data/)
  })
})
