import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type SelfEditProposal,
  SelfEditStore,
  WINDOWS_WRITE_UNSUPPORTED,
  resolveEditablePath,
  selfEditRoots
} from './self-edit'
import { isSensitiveFileName } from './self-edit-path-policy'
import {
  INSTALL_PROVENANCE_FILE,
  type SelfEditRepoRoot,
  resolveSelfEditRepoRoot
} from './self-edit-repo-root'

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

  it('uses the configured ADAM location instead of assuming one home layout (#118)', () => {
    const saved = process.env.DOBIUS_ADAM_PROJECT_DIR
    process.env.DOBIUS_ADAM_PROJECT_DIR = '/opt/adam'
    try {
      expect(selfEditRoots('/Users/x', '/repo')).toEqual(['/repo', '/opt/adam'])
    } finally {
      if (saved === undefined) {
        delete process.env.DOBIUS_ADAM_PROJECT_DIR
      } else {
        process.env.DOBIUS_ADAM_PROJECT_DIR = saved
      }
    }
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

  it('refuses names Windows would alias onto a protected file', () => {
    const root = repo()
    // Why create `.git.`: a missing parent is refused for a different reason;
    // on Windows the kernel would open `.git` for it.
    mkdirSync(join(root, '.git.'))
    for (const name of ['.git./config', '.env ', '.env::$DATA', 'src/voice.ts.']) {
      const result = resolveEditablePath(name, [root])
      expect(result.ok, name).toBe(false)
      expect(result.ok ? '' : result.error, name).toMatch(/different file/)
    }
  })

  it('allows .env templates but no other .env variant', () => {
    const root = repo()
    for (const name of ['.env.example', '.env.sample', '.env.template', 'src/.ENV.Example']) {
      expect(resolveEditablePath(name, [root]).ok, name).toBe(true)
    }
    for (const name of ['.env.example.local', '.env.examples', '.env.local.example']) {
      expect(resolveEditablePath(name, [root]).ok, name).toBe(false)
    }
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

  /** A checkout with an app folder (`<repo>/dobius/package.json`). */
  function checkout(): { repo: string; app: string } {
    const repo = mkdtempSync(join(tmpdir(), 'selfedit-repo-'))
    const app = join(repo, 'dobius')
    mkdirSync(app)
    writeFileSync(join(app, 'package.json'), '{}\n')
    return { repo, app }
  }

  /** A packaged `Contents/Resources` folder, optionally with a provenance stamp. */
  function resources(stamp?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'selfedit-resources-'))
    if (stamp !== undefined) {
      writeFileSync(join(dir, INSTALL_PROVENANCE_FILE), stamp)
    }
    return dir
  }

  function packaged(env: NodeJS.ProcessEnv, resourcesPath: string): SelfEditRepoRoot {
    return resolveSelfEditRepoRoot({ isPackaged: true, env, home, resourcesPath })
  }

  it('packaged: the env override wins over the provenance stamp', () => {
    const configured = checkout()
    const stamped = checkout()
    const result = packaged(
      { DOBIUS_SELF_EDIT_REPO_ROOT: configured.app },
      resources(JSON.stringify({ repo: stamped.repo }))
    )
    expect(result).toEqual({ ok: true, root: configured.app })
  })

  it('packaged: falls back to <provenance.repo>/dobius, not the bundle Contents folder', () => {
    const { repo, app } = checkout()
    const stamp = JSON.stringify({ branch: 'main', commit: 'abc1234', repo })
    expect(packaged({}, resources(stamp))).toEqual({ ok: true, root: app })
  })

  it('packaged: ignores the dev launcher variable', () => {
    const { app } = checkout()
    const result = packaged({ DOBIUS_DEV_REPO_ROOT: app }, resources())
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/no provenance stamp/)
    expect(result.ok ? '' : result.error).toMatch(/DOBIUS_SELF_EDIT_REPO_ROOT/)
  })

  it('packaged: refuses a malformed or repo-less provenance stamp', () => {
    for (const stamp of ['{not json', '[]', '{"branch":"main"}', '{"repo":""}', '{"repo":7}']) {
      const result = packaged({}, resources(stamp))
      expect(result.ok, stamp).toBe(false)
      expect(result.ok ? '' : result.error, stamp).toMatch(/no readable repo path/)
    }
  })

  it('packaged: refuses a stamp pointing at a missing, relative or app-less folder', () => {
    const noApp = mkdtempSync(join(tmpdir(), 'selfedit-noapp-'))
    for (const repo of ['/nonexistent/dobius-plus', 'unknown', noApp]) {
      const result = packaged({}, resources(JSON.stringify({ repo })))
      expect(result.ok, repo).toBe(false)
    }
  })

  it('dev: uses the launcher checkout and refuses when it is unset', () => {
    const { app } = checkout()
    const dev = (env: NodeJS.ProcessEnv): SelfEditRepoRoot =>
      resolveSelfEditRepoRoot({ isPackaged: false, env, home, resourcesPath: resources() })
    expect(dev({ DOBIUS_DEV_REPO_ROOT: app })).toEqual({ ok: true, root: app })
    expect(dev({}).ok).toBe(false)
  })

  it('refuses relative, filesystem-root and home roots and folders without package.json', () => {
    const noApp = mkdtempSync(join(tmpdir(), 'selfedit-noapp-'))
    for (const configured of ['repo/dobius', '/', home, `${home}/`, noApp]) {
      const result = packaged({ DOBIUS_SELF_EDIT_REPO_ROOT: configured }, resources())
      expect(result.ok, configured).toBe(false)
    }
  })

  it('an unconfigured store refuses every proposal with the reason', () => {
    const root = repo()
    const store = new SelfEditStore([], Date.now, 'Self-edit is off: not configured.')
    const proposed = store.propose(join(root, 'src', 'voice.ts'), 'const a = 5\n', 'x')
    expect(proposed).toEqual({ ok: false, error: 'Self-edit is off: not configured.' })
    expect(readFileSync(join(root, 'src', 'voice.ts'), 'utf-8')).toBe('const a = 1\n')
  })
})

describe('concurrency and undo (BUILD-019, #38 #39)', () => {
  function proposeVoice(store: SelfEditStore, content = 'const a = 2\n'): SelfEditProposal {
    const proposed = store.propose('src/voice.ts', content, 'bump')
    if (!proposed.ok) {
      throw new Error(proposed.error)
    }
    return proposed.proposal
  }

  it('refuses to apply over an edit made after the proposal and leaves the file untouched', () => {
    const root = repo()
    const file = join(root, 'src', 'voice.ts')
    const store = new SelfEditStore([root])
    const proposal = proposeVoice(store)

    writeFileSync(file, 'const a = 1 // edited by hand\n')
    const applied = store.apply(proposal.id, join(root, 'backups'))

    expect(applied).toMatchObject({ ok: false, conflict: true })
    expect(applied.ok ? '' : applied.error).toMatch(/changed since Adam proposed/)
    expect(readFileSync(file, 'utf-8')).toBe('const a = 1 // edited by hand\n')
    expect(existsSync(join(root, 'backups'))).toBe(false)
    // Still pending, so the review window keeps showing it until discarded.
    expect(store.get(proposal.id)).not.toBeNull()
  })

  it('detects a same-length change that differs only in invalid utf-8 bytes', () => {
    const root = repo()
    const file = join(root, 'src', 'voice.ts')
    writeFileSync(file, Buffer.from([0x61, 0xff, 0x0a]))
    const store = new SelfEditStore([root])
    const proposal = proposeVoice(store)

    // Decodes to the same string as 0xff, so only a byte digest sees it.
    writeFileSync(file, Buffer.from([0x61, 0xfe, 0x0a]))
    expect(store.apply(proposal.id, join(root, 'backups'))).toMatchObject({ conflict: true })
    expect(readFileSync(file)).toEqual(Buffer.from([0x61, 0xfe, 0x0a]))
  })

  it('refuses to apply a new-file proposal when the file appeared meanwhile', () => {
    const root = repo()
    const store = new SelfEditStore([root])
    const proposed = store.propose('src/new.ts', 'export {}\n', 'create')
    if (!proposed.ok) {
      throw new Error(proposed.error)
    }
    writeFileSync(join(root, 'src', 'new.ts'), 'someone else\n')
    expect(store.apply(proposed.proposal.id, join(root, 'backups'))).toMatchObject({
      conflict: true
    })
    expect(readFileSync(join(root, 'src', 'new.ts'), 'utf-8')).toBe('someone else\n')
  })

  it('apply then undo restores the exact original bytes', () => {
    const root = repo()
    const file = join(root, 'src', 'voice.ts')
    const original = Buffer.from([0x61, 0xff, 0x0d, 0x0a, 0x00])
    writeFileSync(file, original)
    const store = new SelfEditStore([root])
    const proposal = proposeVoice(store)

    expect(store.apply(proposal.id, join(root, 'backups')).ok).toBe(true)
    expect(readFileSync(file, 'utf-8')).toBe('const a = 2\n')

    expect(store.undo(proposal.id)).toEqual({ ok: true, displayPath: 'src/voice.ts' })
    expect(readFileSync(file)).toEqual(original)
    // One step: a second undo has nothing left to restore.
    expect(store.undo(proposal.id)).toEqual({
      ok: false,
      error: 'There is no applied change with that id to undo.'
    })
    expect(readFileSync(file)).toEqual(original)
  })

  it('undo of an edit that created a file removes it again', () => {
    const root = repo()
    const store = new SelfEditStore([root])
    const proposed = store.propose('src/new.ts', 'export {}\n', 'create')
    if (!proposed.ok) {
      throw new Error(proposed.error)
    }
    expect(store.apply(proposed.proposal.id, join(root, 'backups')).ok).toBe(true)
    expect(store.undo(proposed.proposal.id).ok).toBe(true)
    expect(existsSync(join(root, 'src', 'new.ts'))).toBe(false)
  })

  it('refuses to undo when the file changed after the edit, keeping the later edit', () => {
    const root = repo()
    const file = join(root, 'src', 'voice.ts')
    const store = new SelfEditStore([root])
    const proposal = proposeVoice(store)
    expect(store.apply(proposal.id, join(root, 'backups')).ok).toBe(true)

    writeFileSync(file, 'const a = 2 // later edit\n')
    const undone = store.undo(proposal.id)

    expect(undone).toMatchObject({ ok: false, conflict: true })
    expect(undone.ok ? '' : undone.error).toMatch(/changed after the edit was applied/)
    expect(readFileSync(file, 'utf-8')).toBe('const a = 2 // later edit\n')
  })

  it('refuses to undo a created file that was edited afterwards', () => {
    const root = repo()
    const store = new SelfEditStore([root])
    const proposed = store.propose('src/new.ts', 'export {}\n', 'create')
    if (!proposed.ok) {
      throw new Error(proposed.error)
    }
    expect(store.apply(proposed.proposal.id, join(root, 'backups')).ok).toBe(true)
    writeFileSync(join(root, 'src', 'new.ts'), 'export const kept = 1\n')
    expect(store.undo(proposed.proposal.id)).toMatchObject({ conflict: true })
    expect(readFileSync(join(root, 'src', 'new.ts'), 'utf-8')).toBe('export const kept = 1\n')
  })

  it('refuses to undo from a backup that was modified', () => {
    const root = repo()
    const file = join(root, 'src', 'voice.ts')
    const store = new SelfEditStore([root])
    const proposal = proposeVoice(store)
    expect(store.apply(proposal.id, join(root, 'backups')).ok).toBe(true)

    writeFileSync(proposal.appliedBackupPath as string, 'tampered\n')
    expect(store.undo(proposal.id).ok).toBe(false)
    expect(readFileSync(file, 'utf-8')).toBe('const a = 2\n')
  })

  it('never overwrites an earlier backup with the same name', () => {
    const root = repo()
    const backups = join(root, 'backups')
    const store = new SelfEditStore([root], () => 42)
    const proposal = proposeVoice(store)
    mkdirSync(backups)
    writeFileSync(join(backups, `${proposal.id}-42.bak`), 'older backup\n')

    expect(store.apply(proposal.id, backups).ok).toBe(false)
    expect(readFileSync(join(backups, `${proposal.id}-42.bak`), 'utf-8')).toBe('older backup\n')
    expect(readFileSync(join(root, 'src', 'voice.ts'), 'utf-8')).toBe('const a = 1\n')
    expect(readdirSync(backups)).toEqual([`${proposal.id}-42.bak`])
  })
})

describe('Windows write refusal (BUILD-019, review finding)', () => {
  it('refuses apply and undo on win32 with the spoken reason, writing nothing', () => {
    const root = repo()
    const file = join(root, 'src', 'voice.ts')
    const windows = new SelfEditStore([root], Date.now, null, 'win32')
    const proposed = windows.propose('src/voice.ts', 'const a = 2\n', 'bump')
    if (!proposed.ok) {
      throw new Error(proposed.error)
    }
    expect(windows.apply(proposed.proposal.id, join(root, 'backups'))).toEqual({
      ok: false,
      error: WINDOWS_WRITE_UNSUPPORTED
    })
    expect(readFileSync(file, 'utf-8')).toBe('const a = 1\n')
    expect(existsSync(join(root, 'backups'))).toBe(false)
  })

  it('refuses undo on win32 with the spoken reason', () => {
    const root = repo()
    const windows = new SelfEditStore([root], Date.now, null, 'win32')
    expect(windows.undo('edit_1')).toEqual({ ok: false, error: WINDOWS_WRITE_UNSUPPORTED })
    expect(readFileSync(join(root, 'src', 'voice.ts'), 'utf-8')).toBe('const a = 1\n')
  })

  it('keeps writing on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const root = repo()
      const store = new SelfEditStore([root], Date.now, null, platform)
      const proposed = store.propose('src/voice.ts', 'const a = 2\n', 'bump')
      if (!proposed.ok) {
        throw new Error(proposed.error)
      }
      expect(store.apply(proposed.proposal.id, join(root, 'backups')).ok, platform).toBe(true)
      expect(store.undo(proposed.proposal.id).ok, platform).toBe(true)
    }
  })
})

describe('failed writes and unreadable targets (BUILD-019 review F1 F2)', () => {
  it('a failed target write drops its backup so a retry succeeds', () => {
    const root = repo()
    const file = join(root, 'src', 'voice.ts')
    const backups = join(root, 'backups')
    const store = new SelfEditStore([root])
    const proposed = store.propose('src/voice.ts', 'const a = 2\n', 'bump')
    if (!proposed.ok) {
      throw new Error(proposed.error)
    }
    chmodSync(file, 0o444)
    try {
      const failed = store.apply(proposed.proposal.id, backups)
      expect(failed.ok).toBe(false)
      expect(failed.ok ? '' : failed.error).not.toMatch(/EEXIST/)
      expect(readdirSync(backups)).toEqual([])
      expect(proposed.proposal.appliedBackupPath).toBeUndefined()
    } finally {
      chmodSync(file, 0o644)
    }
    expect(store.apply(proposed.proposal.id, backups).ok).toBe(true)
    expect(readFileSync(file, 'utf-8')).toBe('const a = 2\n')
    expect(readFileSync(proposed.proposal.appliedBackupPath as string, 'utf-8')).toBe('const a = 1\n')
  })

  it('refuses a dangling symlink leaf with a message instead of throwing', () => {
    const root = repo()
    symlinkSync(join(root, 'src', 'missing-target.ts'), join(root, 'src', 'dangling.ts'))
    const store = new SelfEditStore([root])
    const proposed = store.propose('src/dangling.ts', 'x\n', 'dangling')
    expect(proposed.ok).toBe(false)
    expect(proposed.ok ? '' : proposed.error).toMatch(/could not be read/)
  })
})
