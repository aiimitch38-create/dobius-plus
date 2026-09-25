// BUILD-044B: the install record lives OUTSIDE the signed bundle. Run ONLY
// against temp fixture dirs (see install-dobius-gated-fixtures.mjs).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  asarOf,
  backupsOf,
  bundleDigest,
  bundleIdentityOf,
  cleanupRoots,
  codesignVerify,
  currentRecordOf,
  dest,
  distBundle,
  git,
  legacyRecordOf,
  makeBundle,
  makeRepo,
  makeRoot,
  provenanceOf,
  recordFor,
  rollbackOf,
  rollbackRecordOf,
  runGated
} from './install-dobius-gated-fixtures.mjs'

afterEach(cleanupRoots)

describe.runIf(process.platform === 'darwin')(
  'install-dobius-gated.sh install record outside the bundle (BUILD-044B)',
  { timeout: 120_000 },
  () => {
    it('installs the signed build byte for byte, so its code signature still verifies', () => {
      const root = makeRoot()
      makeBundle(dest(root), { bundleVersion: '40', asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        bundleVersion: '41',
        asar: 'v2',
        signed: true
      })
      const before = bundleDigest(built)

      const result = runGated(root, [built])

      expect(result.status, result.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('v2')
      expect(bundleDigest(dest(root))).toBe(before)
      expect(existsSync(legacyRecordOf(dest(root)))).toBe(false)
      const verify = codesignVerify(dest(root))
      expect(verify.status, verify.stderr).toBe(0)
      expect(provenanceOf(dest(root))).toMatchObject({ buildNumber: 41, installedBy: 'fixture' })
    })

    it('keeps each record paired with its bundle through install and rollback', () => {
      const root = makeRoot()
      const repo = makeRepo(root)
      const commit = git(repo, 'rev-parse', '--short', 'HEAD')
      expect(runGated(root, [distBundle(root, { bundleVersion: '42', asar: 'v2' })]).status).toBe(
        0
      )
      expect(provenanceOf(dest(root))).toMatchObject({
        branch: 'main',
        commit,
        buildNumber: 42,
        sourceStateFrom: 'install'
      })

      const v3 = distBundle(root, { bundleVersion: '43', asar: 'v3' })
      writeFileSync(
        path.join(v3, 'Contents', 'Resources', 'BUILD-PROVENANCE.json'),
        JSON.stringify({
          repo: '/build/lane-3',
          branch: 'lane-3',
          commit: 'abc1234',
          dirty: false,
          diffDigest: null,
          tag: null,
          buildNumber: 43
        })
      )
      const upgrade = runGated(root, [v3, '--take-over'])
      expect(upgrade.status, upgrade.stderr).toBe(0)
      expect(provenanceOf(dest(root))).toMatchObject({ branch: 'lane-3', buildNumber: 43 })
      expect(asarOf(rollbackOf(root))).toBe('v2')
      expect(recordFor(rollbackOf(root), rollbackRecordOf(root))).toMatchObject({
        branch: 'main',
        commit,
        buildNumber: 42
      })

      // The documented rollback: reinstall the rollback copy.
      const rollback = runGated(root, [rollbackOf(root), '--take-over', '--allow-downgrade'])

      expect(rollback.status, rollback.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('v2')
      // v2 has no build record: its own install record, not the backups folder, says what it is.
      expect(provenanceOf(dest(root))).toMatchObject({
        branch: 'main',
        commit,
        repo: expect.stringContaining('repo'),
        buildNumber: 42,
        sourceStateFrom: 'previous-install'
      })
      expect(asarOf(rollbackOf(root))).toBe('v3')
      expect(recordFor(rollbackOf(root), rollbackRecordOf(root))).toMatchObject({
        branch: 'lane-3',
        buildNumber: 43
      })
      expect(readdirSync(backupsOf(root))).toEqual([
        'Dobius+.previous',
        'Dobius+.previous.INSTALL-PROVENANCE.json',
        'INSTALL-PROVENANCE.json'
      ])
    })

    it('leaves the install records untouched when an install fails', () => {
      const root = makeRoot()
      const first = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        bundleVersion: '41',
        asar: 'v1'
      })
      expect(runGated(root, [first]).status).toBe(0)
      const record = readFileSync(currentRecordOf(root), 'utf8')

      const invalid = makeBundle(path.join(root, 'bad', 'Dobius+.app'), {
        bundleVersion: '42',
        withAsar: false
      })
      expect(runGated(root, [invalid]).status).toBe(7)

      const valid = makeBundle(path.join(root, 'good', 'Dobius+.app'), {
        bundleVersion: '42',
        asar: 'v2'
      })
      execFileSync('chflags', ['uchg', dest(root)])
      const swapFailed = runGated(root, [valid])
      execFileSync('chflags', ['nouchg', dest(root)])
      expect(swapFailed.status, swapFailed.stderr).toBe(8)

      expect(asarOf(dest(root))).toBe('v1')
      expect(readFileSync(currentRecordOf(root), 'utf8')).toBe(record)
      expect(readdirSync(backupsOf(root))).toEqual(['INSTALL-PROVENANCE.json'])
      expect(existsSync(path.join(root, 'install.lock'))).toBe(false)
    })

    it('reads the owner from the record that names the installed bundle, else the legacy one inside it', () => {
      const root = makeRoot()
      makeBundle(dest(root), { bundleVersion: '41', asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        bundleVersion: '42',
        asar: 'v2'
      })
      const otherBundle = makeBundle(path.join(root, 'other', 'Dobius+.app'), {
        bundleVersion: '40'
      })
      const writeCurrent = (record) => {
        mkdirSync(backupsOf(root), { recursive: true })
        writeFileSync(currentRecordOf(root), JSON.stringify(record))
      }

      writeCurrent({ branch: 'record-lane', bundleIdentity: bundleIdentityOf(dest(root)) })
      const owned = runGated(root, [built])
      expect(owned.status, owned.stderr).toBe(3)
      expect(owned.stderr).toContain("belongs to branch 'record-lane'")

      // A record naming another bundle is not this app's: the legacy one inside it is.
      writeCurrent({ branch: 'record-lane', bundleIdentity: bundleIdentityOf(otherBundle) })
      writeFileSync(legacyRecordOf(dest(root)), JSON.stringify({ branch: 'legacy-lane' }))
      const legacy = runGated(root, [built])
      expect(legacy.status, legacy.stderr).toBe(3)
      expect(legacy.stderr).toContain("belongs to branch 'legacy-lane'")

      const takeOver = runGated(root, [built, '--take-over'])
      expect(takeOver.status, takeOver.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('v2')
      provenanceOf(dest(root))
    })
  }
)
