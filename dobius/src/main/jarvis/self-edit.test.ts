import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SelfEditStore, resolveEditablePath, selfEditRoots } from './self-edit'

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
