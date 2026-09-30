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
  runGated,
  runGatedAsync
} from './install-dobius-gated-fixtures.mjs'

afterEach(cleanupRoots)

// App management on a fixture DEST with recorder shims (quit/kill are no-ops,
// `open` is traced), plus any extra command shims a test needs.
function withShims(root, extra = {}) {
  const dir = path.join(root, 'shims')
  const trace = path.join(root, 'open-trace.log')
  mkdirSync(dir)
  const shims = {
    osascript: 'exit 0',
    pgrep: 'exit 1',
    pkill: 'exit 0',
    lsregister: 'exit 0',
    open: `echo "$*" >> "${trace}"`,
    ...extra
  }
  for (const [name, body] of Object.entries(shims)) {
    writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
  }
  return {
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      DOBIUS_INSTALL_TEST_MANAGE_APP: '1',
      DOBIUS_INSTALL_LSREGISTER: path.join(dir, 'lsregister')
    },
    opened: () => (existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [])
  }
}

// The shims' own dir is first on PATH; drop it to reach the real command.
const REAL_PATH = 'PATH="${PATH#*:}"'
// The swap is the only `python3 -` call with exactly two arguments.
const IS_SWAP = '[ "$1" = "-" ] && [ "$#" = 3 ]'

// v1 installed through the installer (so it has a record), v2 ready to install.
function installedV1(root) {
  const v1 = makeBundle(path.join(root, 'h1', 'Dobius+.app'), { bundleVersion: '41', asar: 'v1' })
  expect(runGated(root, [v1]).status).toBe(0)
  return makeBundle(path.join(root, 'h2', 'Dobius+.app'), { bundleVersion: '42', asar: 'v2' })
}

function expectV2InstalledWithV1Rollback(root) {
  expect(asarOf(dest(root))).toBe('v2')
  expect(provenanceOf(dest(root))).toMatchObject({ buildNumber: 42 })
  expect(asarOf(rollbackOf(root))).toBe('v1')
  expect(recordFor(rollbackOf(root), rollbackRecordOf(root))).toMatchObject({ buildNumber: 41 })
  expect(readdirSync(path.join(root, 'Applications'))).toEqual(['Dobius+.app'])
  expect(readdirSync(backupsOf(root))).toEqual([
    'Dobius+.previous',
    'Dobius+.previous.INSTALL-PROVENANCE.json',
    'INSTALL-PROVENANCE.json'
  ])
  expect(existsSync(path.join(root, 'install.lock'))).toBe(false)
}

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
      expect(runGated(root, [distBundle(root, { bundleVersion: '42', asar: 'v2' })]).status).toBe(0)
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

    it('TERM during the swap keeps the previous bundle as the rollback and promotes the record (review F1)', () => {
      const root = makeRoot()
      const v2 = installedV1(root)
      const shims = withShims(root, {
        python3: `if ${IS_SWAP}; then kill -TERM "$PPID"; fi\n${REAL_PATH} exec python3 "$@"`
      })

      const result = runGated(root, [v2], shims.env)

      expect(result.status, result.stderr).toBe(130)
      expectV2InstalledWithV1Rollback(root)
      expect(shims.opened()).toHaveLength(1)
      expect(readFileSync(path.join(root, 'history.log'), 'utf8').trim().split('\n')).toHaveLength(
        2
      )
    })

    it('ignores process-group SIGINT until swap, cleanup and history are complete', async () => {
      const root = makeRoot()
      installedV1(root)
      const built = distBundle(root, { bundleVersion: '42', asar: 'v2' })
      const mark = path.join(root, 'inside-critical-section')
      const release = path.join(root, 'release-critical-section')
      const shims = withShims(root, {
        pgrep: `touch "${mark}"\nwhile [ ! -e "${release}" ]; do /bin/sleep 0.02; done\nexit 1`
      })
      let childPid = 0
      const resultPromise = runGatedAsync(root, [built], shims.env, {
        detached: true,
        onSpawn: (child) => {
          childPid = child.pid
        }
      })
      for (let attempt = 0; attempt < 1_500 && !existsSync(mark); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(existsSync(mark)).toBe(true)
      expect(childPid).toBeGreaterThan(0)
      process.kill(-childPid, 'SIGINT')
      writeFileSync(release, '')

      const result = await resultPromise
      expect(result.status, result.stderr).toBe(0)
      expectV2InstalledWithV1Rollback(root)
      expect(existsSync(built)).toBe(false)
      expect(readFileSync(path.join(root, 'history.log'), 'utf8').trim().split('\n')).toHaveLength(
        2
      )
      expect(shims.opened()).toHaveLength(1)
    }, 30_000)

    it('TERM right after the record rotation keeps the rollback record (review F2)', () => {
      const root = makeRoot()
      const v2 = installedV1(root)
      const mark = path.join(root, 'signalled')
      const shims = withShims(root, {
        mv: `/bin/mv "$@"; rc=$?\nif [ "$2" = "${currentRecordOf(root)}" ] && [ ! -e "${mark}" ]; then touch "${mark}"; kill -TERM "$PPID"; fi\nexit $rc`
      })

      const result = runGated(root, [v2], shims.env)

      expect(existsSync(mark)).toBe(true)
      expect(result.status, result.stderr).toBe(130)
      expectV2InstalledWithV1Rollback(root)
    })

    it('retrying a partly done record promotion keeps the rollback record and leaves no tmp (review F2)', () => {
      const root = makeRoot()
      const v2 = installedV1(root)
      const mark = path.join(root, 'failed-once')
      // The first copy of the pending record fails; the cleanup trap retries it.
      const shims = withShims(root, {
        cat: `if [ "$1" = "${path.join(root, 'install.lock', 'INSTALL-PROVENANCE.json')}" ] && [ ! -e "${mark}" ]; then touch "${mark}"; exit 1; fi\nexec /bin/cat "$@"`
      })

      const result = runGated(root, [v2], shims.env)

      expect(existsSync(mark)).toBe(true)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toContain('could not write the install record')
      expectV2InstalledWithV1Rollback(root)
    })

    it('completes the install when the swap reports failure after it already swapped', () => {
      const root = makeRoot()
      const v2 = installedV1(root)
      const shims = withShims(root, {
        python3: `if ${IS_SWAP}; then ${REAL_PATH} python3 "$@"; exit 1; fi\n${REAL_PATH} exec python3 "$@"`
      })

      const result = runGated(root, [v2], shims.env)

      expect(result.status, result.stderr).toBe(0)
      expectV2InstalledWithV1Rollback(root)
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
