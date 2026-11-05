import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  asarOf,
  cleanupRoots,
  dest,
  distBundle,
  git,
  makeBundle,
  makeRepo,
  makeRoot,
  rollbackOf,
  runGated,
  stageOf
} from './install-dobius-gated-fixtures.mjs'

afterEach(cleanupRoots)

describe.runIf(process.platform === 'darwin')(
  'installed release source history',
  { timeout: 90_000 },
  () => {
    function installedUi() {
      const root = makeRoot()
      const repo = makeRepo(root)
      const base = git(repo, 'rev-parse', 'HEAD')
      git(repo, 'checkout', '-qb', 'new-ui')
      writeFileSync(path.join(repo, 'src.txt'), 'Board and Home UI\n')
      git(repo, 'commit', '-qam', 'new UI')
      const built = distBundle(root, { version: '2.1.7', asar: 'new-ui' })
      const installed = runGated(root, [built])
      expect(installed.status, installed.stderr).toBe(0)
      return { root, repo, base, built }
    }

    it('rejects a higher version from an older divergent branch, even with take-over', () => {
      const { root, repo, base } = installedUi()
      git(repo, 'checkout', '-qb', 'old-ui-release', base)
      writeFileSync(path.join(repo, 'src.txt'), 'old UI plus voice\n')
      git(repo, 'commit', '-qam', 'voice changes on old UI')
      const built = distBundle(root, { version: '2.1.8', asar: 'old-ui' })
      const refused = runGated(root, [built, '--take-over'])
      expect(refused.status, refused.stderr).toBe(11)
      expect(refused.stderr).toContain('does not include installed release')
      expect(asarOf(dest(root))).toBe('new-ui')
      expect(existsSync(stageOf(root))).toBe(false)
    })

    it('accepts a descendant from another branch after preserving the installed UI', () => {
      const { root, repo } = installedUi()
      git(repo, 'checkout', '-qb', 'integrated-release')
      writeFileSync(path.join(repo, 'voice.txt'), 'face and Hermes\n')
      git(repo, 'add', '.')
      git(repo, 'commit', '-qm', 'integrate voice')
      const built = distBundle(root, { version: '2.1.8', asar: 'integrated-ui' })
      const result = runGated(root, [built, '--take-over'])
      expect(result.status, result.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('integrated-ui')
      const rollback = runGated(root, [rollbackOf(root), '--take-over', '--allow-downgrade'])
      expect(rollback.status, rollback.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('new-ui')
    })

    it('refuses an untraceable handoff over a known installed release', () => {
      const { root } = installedUi()
      // A missing checkout must not silently become permission to lose installed history.
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { version: '2.1.8' })
      expect(runGated(root, [built, '--take-over']).status).toBe(11)
    })
  }
)
