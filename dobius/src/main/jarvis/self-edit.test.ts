import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SelfEditStore,
  isSensitiveFileName,
  resolveEditablePath,
  resolveSelfEditRepoRoot,
  selfEditRoots
} from './self-edit'

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'selfedit-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'voice.ts'), 'const a = 1\n')
  return root
}

describe('selfEditRoots', () => {
  it('covers the app repo and the ADAM service', () => {
    expect(selfEditRoots('/Users/x', '/repo')).toEqual([
      '/repo',
      '/Users/x/dobius/projects/ADAM'
    ])
  })
})

describe('resolveEditablePath', () => {
  it('accepts a relative path inside a root', () => {
    const root = repo()
    const result = resolveEditablePath('src/voice.ts', [root])
    expect(result.ok).toBe(true)
  })

  it('refuses a path outside every root', () => {
    const root = repo()
    const result = resolveEditablePath('/etc/hosts', [root])
    expect(result.ok).toBe(false)
  })

  it('refuses traversal back out of a root', () => {
    const root = repo()
    const result = resolveEditablePath('../../etc/hosts', [root])
    expect(result.ok).toBe(false)
  })

  it('refuses protected directories', () => {
    const root = repo()
    expect(resolveEditablePath('.git/config', [root]).ok).toBe(false)
    expect(resolveEditablePath('node_modules/x/index.js', [root]).ok).toBe(false)
  })

  it('refuses a symlinked escape out of a root', () => {
    const root = repo()
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    // Only the "escape" directory is a symlink; the root resolves to itself.
    const realpath = (path: string): string => (path.endsWith('escape') ? outside : path)
    const result = resolveEditablePath('escape/hosts', [root], realpath)
    expect(result.ok).toBe(false)
  })
})

describe('SelfEditStore', () => {
  it('proposes, then applies with a backup', () => {
    const root = repo()
    const store = new SelfEditStore([root])
    const proposed = store.propose('src/voice.ts', 'const a = 2\n', 'bump')
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) {
      return
    }

    expect(proposed.proposal.displayPath).toBe('src/voice.ts')
    expect(proposed.proposal.oldContent).toBe('const a = 1\n')

    const backups = join(root, 'backups')
    const applied = store.apply(proposed.proposal.id, backups)
    expect(applied.ok).toBe(true)
    expect(readFileSync(join(root, 'src', 'voice.ts'), 'utf-8')).toBe('const a = 2\n')
    // The original survives so an approved change can be undone.
    expect(readFileSync(proposed.proposal.appliedBackupPath as string, 'utf-8')).toBe('const a = 1\n')
  })

  it('refuses a no-op change', () => {
    const root = repo()
    const store = new SelfEditStore([root])
    expect(store.propose('src/voice.ts', 'const a = 1\n', 'same').ok).toBe(false)
  })

  it('cannot apply a discarded proposal', () => {
    const root = repo()
    const store = new SelfEditStore([root])
    const proposed = store.propose('src/voice.ts', 'const a = 3\n', 'x')
    if (!proposed.ok) {
      throw new Error('expected proposal')
    }
    expect(store.discard(proposed.proposal.id)).toBe(true)
    expect(store.apply(proposed.proposal.id, join(root, 'backups')).ok).toBe(false)
    expect(readFileSync(join(root, 'src', 'voice.ts'), 'utf-8')).toBe('const a = 1\n')
  })

  it('refuses an oversized change', () => {
    const root = repo()
    const store = new SelfEditStore([root])
    expect(store.propose('src/voice.ts', 'x'.repeat(600_000), 'huge').ok).toBe(false)
  })
})

describe('symlink escape (regression: security review 2026-08-29)', () => {
  it('refuses a real symlinked FILE inside a root that points outside it', () => {
    const root = repo()
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'original secret\n')
    // A symlink that LIVES inside the root but RESOLVES outside it.
    symlinkSync(secret, join(root, 'src', 'sneaky.ts'))

    const store = new SelfEditStore([root])
    const proposed = store.propose('src/sneaky.ts', 'pwned\n', 'escape attempt')

    expect(proposed.ok).toBe(false)
    expect(readFileSync(secret, 'utf-8')).toBe('original secret\n')
  })

  it('still allows a regular file in the same directory', () => {
    const root = repo()
    const store = new SelfEditStore([root])
    expect(store.propose('src/voice.ts', 'const a = 9\n', 'fine').ok).toBe(true)
  })
})

describe('canonical path policy (BUILD-006, #26 #27)', () => {
  it('refuses an in-root symlinked FILE that points at .env.local', () => {
    const root = repo()
    writeFileSync(join(root, '.env.local'), 'SECRET=1\n')
    symlinkSync(join(root, '.env.local'), join(root, 'src', 'config.ts'))

    const store = new SelfEditStore([root])
    const proposed = store.propose('src/config.ts', 'SECRET=pwned\n', 'rewrite config')

    expect(proposed.ok).toBe(false)
    expect(readFileSync(join(root, '.env.local'), 'utf-8')).toBe('SECRET=1\n')
  })

  it('refuses an in-root symlinked DIRECTORY that points into .git', () => {
    const root = repo()
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'config'), '[core]\n')
    symlinkSync(join(root, '.git'), join(root, 'src', 'meta'))

    const store = new SelfEditStore([root])
    expect(store.propose('src/meta/config', '[core]\nhooksPath=/tmp\n', 'x').ok).toBe(false)
    expect(store.propose('src/meta/hooks-new', '#!/bin/sh\n', 'x').ok).toBe(false)
    expect(readFileSync(join(root, '.git', 'config'), 'utf-8')).toBe('[core]\n')
  })

  it('refuses every .env variant and credential file, directly and in subfolders', () => {
    const root = repo()
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      'src/.env.development.local',
      '.ENV.Local',
      '.npmrc',
      'auth.json',
      'certs/server.pem',
      'service/data/service-token'
    ]) {
      const result = resolveEditablePath(name, [root])
      expect(result.ok, name).toBe(false)
    }
  })

  it('refuses a protected directory whatever its case', () => {
    const root = repo()
    mkdirSync(join(root, 'Out'))
    // Why an existing folder: a missing parent is refused for a different reason.
    expect(resolveEditablePath('Out/bundle.js', [root]).ok).toBe(false)
  })

  it('still allows ordinary source edits, including env-like source names', () => {
    const root = repo()
    expect(resolveEditablePath('src/voice.ts', [root]).ok).toBe(true)
    expect(resolveEditablePath('src/env.ts', [root]).ok).toBe(true)
    expect(resolveEditablePath('src/token-utils.ts', [root]).ok).toBe(true)
    expect(isSensitiveFileName('environment.ts')).toBe(false)
  })

  it('refuses to apply when a parent folder was swapped for a symlink after proposing', () => {
    const root = repo()
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'voice.ts'), 'git internals\n')
    const store = new SelfEditStore([root])
    const proposed = store.propose('src/voice.ts', 'const a = 2\n', 'bump')
    if (!proposed.ok) {
      throw new Error('expected proposal')
    }

    renameSync(join(root, 'src'), join(root, 'src-old'))
    symlinkSync(join(root, '.git'), join(root, 'src'))

    const applied = store.apply(proposed.proposal.id, join(root, 'backups'))
    expect(applied.ok).toBe(false)
    expect(readFileSync(join(root, '.git', 'voice.ts'), 'utf-8')).toBe('git internals\n')
  })
})

describe('resolveSelfEditRepoRoot (BUILD-006, X1)', () => {
  const home = '/Users/x'
  const isDirectory = (path: string): boolean => path === '/repo/dobius-plus'

  it('uses the configured repo when packaged, not the bundle Contents folder', () => {
    const result = resolveSelfEditRepoRoot({
      isPackaged: true,
      env: { DOBIUS_SELF_EDIT_REPO_ROOT: '/repo/dobius-plus' },
      home,
      isDirectory
    })
    expect(result).toEqual({ ok: true, root: '/repo/dobius-plus' })
  })

  it('refuses with a visible reason when packaged and nothing is configured', () => {
    const result = resolveSelfEditRepoRoot({
      isPackaged: true,
      // The dev launcher variable must not leak into a packaged app's choice.
      env: { DOBIUS_DEV_REPO_ROOT: '/repo/dobius-plus' },
      home,
      isDirectory
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/DOBIUS_SELF_EDIT_REPO_ROOT/)
  })

  it('uses the dev launcher checkout in dev', () => {
    expect(
      resolveSelfEditRepoRoot({
        isPackaged: false,
        env: { DOBIUS_DEV_REPO_ROOT: '/repo/dobius-plus' },
        home,
        isDirectory
      })
    ).toEqual({ ok: true, root: '/repo/dobius-plus' })
  })

  it('refuses relative, filesystem-root and home roots even when they exist', () => {
    for (const configured of ['repo/dobius-plus', '/', home, `${home}/`]) {
      const result = resolveSelfEditRepoRoot({
        isPackaged: true,
        env: { DOBIUS_SELF_EDIT_REPO_ROOT: configured },
        home,
        isDirectory: () => true
      })
      expect(result.ok, configured).toBe(false)
    }
  })

  it('refuses a configured root that does not exist', () => {
    const result = resolveSelfEditRepoRoot({
      isPackaged: true,
      env: { DOBIUS_SELF_EDIT_REPO_ROOT: '/repo/missing' },
      home,
      isDirectory
    })
    expect(result.ok).toBe(false)
  })

  it('an unconfigured store refuses every proposal with the reason', () => {
    const root = repo()
    const store = new SelfEditStore([], Date.now, 'Self-edit is off: not configured.')
    const proposed = store.propose(join(root, 'src', 'voice.ts'), 'const a = 5\n', 'x')
    expect(proposed).toEqual({ ok: false, error: 'Self-edit is off: not configured.' })
    expect(readFileSync(join(root, 'src', 'voice.ts'), 'utf-8')).toBe('const a = 1\n')
  })
})
