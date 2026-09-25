// BUILD-044: version guard and provenance of the gated installer, run ONLY
// against temp fixture dirs (see install-dobius-gated-fixtures.mjs).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  asarOf,
  cleanupRoots,
  dest,
  distBundle,
  envFor,
  gatedScript,
  git,
  makeBundle,
  makeRepo,
  makeRoot,
  provenanceOf,
  repoRoot,
  runGated
} from './install-dobius-gated-fixtures.mjs'

const semverScript = path.join(repoRoot, 'scripts', 'semver-compare.py')

afterEach(cleanupRoots)

// BUILD-044 (#102): SemVer precedence, straight from the helper the installer calls.
const semver = (...args) =>
  spawnSync('python3', [semverScript, ...args], { encoding: 'utf8' }).status

describe('semver-compare.py (#102, N8)', () => {
  // [newer, older]: each pair is checked both ways.
  const ordered = [
    ['2.0.0-rc.2', '2.0.0-rc.1'],
    ['2.0.0', '2.0.0-rc.2'],
    ['2.0.0', '2.0.0-rc.1'],
    ['2.0.1', '2.0.0'],
    ['2.0.1-rc.1', '2.0.0'],
    ['2.0.0-rc.10', '2.0.0-rc.2'],
    ['2.0.0-rc.1', '1.0.66'],
    ['10.0.0', '9.9.9'],
    ['1.0.0-alpha.beta', '1.0.0-alpha.1'],
    ['1.0.0-alpha.1', '1.0.0-alpha'],
    ['1.0.0-beta', '1.0.0-alpha.beta']
  ]

  it.each(ordered)('%s >= %s, and not the other way round', (newer, older) => {
    expect(semver('ge', newer, older)).toBe(0)
    expect(semver('ge', older, newer)).toBe(1)
  })

  it('treats equal versions as not older, and ignores build metadata both ways', () => {
    expect(semver('ge', '2.0.0', '2.0.0')).toBe(0)
    expect(semver('ge', '2.0.0+5', '2.0.0+9')).toBe(0)
    expect(semver('ge', '2.0.0+9', '2.0.0+5')).toBe(0)
    expect(semver('ge', '2.0.0-rc.1+900', '2.0.0+1')).toBe(1)
  })

  it.each([
    '',
    '2.0',
    '2.0.0.1',
    'v2.0.0',
    '02.0.0',
    '2.0.0-',
    '2.0.0-rc.01',
    "File Doesn't Exist, Will Create: /tmp/1/2/3/Info.plist"
  ])('refuses %j as a version', (bad) => {
    expect(semver('valid', bad)).toBe(2)
    expect(semver('ge', bad, '2.0.0')).toBe(2)
    expect(semver('ge', '2.0.0', bad)).toBe(2)
  })
})

describe.runIf(process.platform === 'darwin')(
  'install-dobius-gated.sh version guard and provenance (BUILD-044)',
  { timeout: 90_000 },
  () => {
    it('refuses a release candidate over the stable app it precedes (#102)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { version: '2.0.0', asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        version: '2.0.0-rc.1',
        asar: 'v2'
      })

      const result = runGated(root, [built])

      expect(result.status, result.stderr).toBe(5)
      expect(result.stderr).toContain('DOWNGRADE')
      expect(asarOf(dest(root))).toBe('v1')
      expect(existsSync(path.join(root, 'install.lock'))).toBe(false)
    })

    it('installs the stable release over its release candidate (#102)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { version: '2.0.0-rc.2', asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        version: '2.0.0',
        asar: 'v2'
      })

      const result = runGated(root, [built])

      expect(result.status, result.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('v2')
    })

    it('refuses a build with no version, even with --take-over --allow-downgrade (N8)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        version: null,
        asar: 'v2'
      })

      for (const args of [[built], [built, '--take-over', '--allow-downgrade']]) {
        const result = runGated(root, args)
        expect(result.status, result.stderr).toBe(5)
        expect(result.stderr).toContain('no valid version')
        expect(asarOf(dest(root))).toBe('v1')
      }
    })

    it('refuses to replace an installed app with no version unless --allow-downgrade (N8)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { version: null, asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })

      const refused = runGated(root, [built])
      expect(refused.status, refused.stderr).toBe(5)
      expect(refused.stderr).toContain('cannot be proven not to be a downgrade')
      expect(asarOf(dest(root))).toBe('v1')

      const ownershipOnly = runGated(root, [built, '--take-over'])
      expect(ownershipOnly.status, ownershipOnly.stderr).toBe(5)
      expect(asarOf(dest(root))).toBe('v1')

      const allowed = runGated(root, [built, '--allow-downgrade'])
      expect(allowed.status, allowed.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('v2')
    })

    it('records a clean tree, the release tag, version, build number and artifact hash (#109, #110)', () => {
      const root = makeRoot()
      const repo = makeRepo(root)
      git(repo, 'tag', '-a', 'v2.0.0', '-m', 'release 2.0.0')
      const built = distBundle(root, { version: '2.0.0', bundleVersion: '41', asar: 'v2' })

      const result = runGated(root, [built])

      expect(result.status, result.stderr).toBe(0)
      expect(provenanceOf(dest(root))).toMatchObject({
        branch: 'main',
        commit: git(repo, 'rev-parse', '--short', 'HEAD'),
        dirty: false,
        diffDigest: null,
        tag: 'v2.0.0',
        sourceStateFrom: 'install',
        version: '2.0.0',
        buildNumber: 41,
        artifactSha256: createHash('sha256').update('v2').digest('hex')
      })
      expect(readFileSync(path.join(root, 'history.log'), 'utf8')).toContain(
        'version 2.0.0 build 41'
      )
    })

    it('records a dirty tree with a digest of the uncommitted changes (X2, #109)', () => {
      const root = makeRoot()
      const repo = makeRepo(root)
      writeFileSync(path.join(repo, 'src.txt'), 'edited but not committed\n')
      const first = distBundle(root, { bundleVersion: '42', asar: 'v2' })
      expect(runGated(root, [first]).status).toBe(0)
      const dirtyEdit = provenanceOf(dest(root))

      expect(dirtyEdit).toMatchObject({
        dirty: true,
        tag: null,
        buildNumber: 42,
        sourceStateFrom: 'install'
      })
      expect(dirtyEdit.diffDigest).toMatch(/^sha256:[0-9a-f]{64}$/)

      // A different uncommitted change (an untracked file) gives a different digest.
      writeFileSync(path.join(repo, 'new-untracked.txt'), 'x\n')
      const second = distBundle(root, { bundleVersion: '43', asar: 'v3' })
      expect(runGated(root, [second]).status).toBe(0)
      const withUntracked = provenanceOf(dest(root))
      expect(withUntracked).toMatchObject({ dirty: true, buildNumber: 43 })
      expect(withUntracked.diffDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(withUntracked.diffDigest).not.toBe(dirtyEdit.diffDigest)
    })

    it('records no build number for a bundle packaged without the counter', () => {
      const root = makeRoot()
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        bundleVersion: '2.0.0',
        asar: 'v2'
      })

      expect(runGated(root, [built]).status).toBe(0)
      expect(provenanceOf(dest(root))).toMatchObject({
        buildNumber: null,
        dirty: null,
        diffDigest: null,
        tag: null
      })
    })

    it('--take-over alone does not allow a downgrade; --allow-downgrade does (F2)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { version: '2.0.1', asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        version: '2.0.0',
        asar: 'v2'
      })

      const takeOver = runGated(root, [built, '--take-over'])
      expect(takeOver.status, takeOver.stderr).toBe(5)
      expect(takeOver.stderr).toContain('--allow-downgrade')
      expect(asarOf(dest(root))).toBe('v1')

      const allowed = runGated(root, [built, '--allow-downgrade'])
      expect(allowed.status, allowed.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('v2')
    })

    it('--allow-downgrade does not take over another branch (F2)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { version: '2.0.1', asar: 'v1' })
      writeFileSync(
        path.join(dest(root), 'Contents', 'Resources', 'INSTALL-PROVENANCE.json'),
        JSON.stringify({ branch: 'other-lane' })
      )
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })

      const result = runGated(root, [built, '--allow-downgrade'])

      expect(result.status, result.stderr).toBe(3)
      expect(asarOf(dest(root))).toBe('v1')
      expect(runGated(root, [built, '--bogus']).status).toBe(1)
    })

    it('records the source state sealed into the bundle at BUILD time (F1)', () => {
      const root = makeRoot()
      const repo = makeRepo(root)
      const built = distBundle(root, { bundleVersion: '44', asar: 'v2' })
      const buildRecord = {
        repo: '/build/checkout',
        branch: 'build-branch',
        commit: 'abc1234',
        dirty: true,
        diffDigest: `sha256:${'a'.repeat(64)}`,
        tag: null,
        buildNumber: 44
      }
      writeFileSync(
        path.join(built, 'Contents', 'Resources', 'BUILD-PROVENANCE.json'),
        JSON.stringify(buildRecord)
      )

      const result = runGated(root, [built])

      // The checkout at install time is clean on 'main'; the record must win.
      expect(result.status, result.stderr).toBe(0)
      expect(git(repo, 'status', '--porcelain')).toBe('')
      expect(provenanceOf(dest(root))).toMatchObject({
        repo: '/build/checkout',
        branch: 'build-branch',
        commit: 'abc1234',
        dirty: true,
        diffDigest: buildRecord.diffDigest,
        tag: null,
        sourceStateFrom: 'build',
        buildNumber: 44
      })
    })

    it('falls back to the install-time tree when the build record is malformed (F1)', () => {
      const root = makeRoot()
      makeRepo(root)
      const built = distBundle(root, { asar: 'v2' })
      writeFileSync(
        path.join(built, 'Contents', 'Resources', 'BUILD-PROVENANCE.json'),
        JSON.stringify({ branch: 'build-branch', dirty: 'yes' })
      )

      const result = runGated(root, [built])

      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toContain('not a valid build record')
      expect(provenanceOf(dest(root))).toMatchObject({
        branch: 'main',
        dirty: false,
        sourceStateFrom: 'install'
      })
    })

    it('ignores a build record whose buildNumber is not the bundle CFBundleVersion (round 3 F2)', () => {
      const root = makeRoot()
      makeRepo(root)
      const built = distBundle(root, { bundleVersion: '44', asar: 'v2' })
      writeFileSync(
        path.join(built, 'Contents', 'Resources', 'BUILD-PROVENANCE.json'),
        JSON.stringify({
          repo: '/build/checkout',
          branch: 'main',
          commit: 'abc1234',
          dirty: false,
          diffDigest: null,
          tag: null,
          buildNumber: 45
        })
      )

      const result = runGated(root, [built])

      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toContain('not a valid build record for this bundle')
      expect(provenanceOf(dest(root))).toMatchObject({
        repo: realpathSync(path.join(root, 'repo')),
        sourceStateFrom: 'install',
        buildNumber: 44
      })
    })

    it('keeps the previous bundle as the rollback and relaunches when TERM lands right after the swap (round 3 F3)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })
      const shims = path.join(root, 'shims')
      const trace = path.join(root, 'open-trace.log')
      const mark = path.join(root, 'signalled')
      mkdirSync(shims)
      const shim = (name, body) =>
        writeFileSync(path.join(shims, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
      shim('osascript', 'exit 0')
      shim('pgrep', 'exit 1')
      shim('pkill', 'exit 0')
      shim('lsregister', 'exit 0')
      shim('open', `echo "$*" >> "${trace}"`)
      // The first `mkdir -p` after the swap is the rollback move: signal the
      // installer there, exactly between the swap and the move.
      shim(
        'mkdir',
        `if [ "$1" = "-p" ] && [ ! -e "${mark}" ]; then touch "${mark}"; kill -TERM "$PPID"; fi\nexec /bin/mkdir "$@"`
      )

      const result = runGated(root, [built], {
        PATH: `${shims}:${process.env.PATH}`,
        DOBIUS_INSTALL_TEST_MANAGE_APP: '1',
        DOBIUS_INSTALL_LSREGISTER: path.join(shims, 'lsregister')
      })

      expect(existsSync(mark)).toBe(true)
      expect(result.status, result.stderr).toBe(130)
      expect(asarOf(dest(root))).toBe('v2')
      expect(asarOf(path.join(root, 'backups', 'Dobius+.previous'))).toBe('v1')
      expect(readdirSync(path.join(root, 'Applications'))).toEqual(['Dobius+.app'])
      expect(existsSync(path.join(root, 'install.lock'))).toBe(false)
      expect(readFileSync(trace, 'utf8').trim()).toBe(
        `-a ${path.join(realpathSync(root), 'Applications', 'Dobius+.app')}`
      )
    })

    it('refuses with a clear reason when an installer helper is missing (F4)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })
      // A copy of the installer without the python helpers beside it.
      const lonely = path.join(root, 'lonely', 'install-dobius-gated.sh')
      mkdirSync(path.dirname(lonely))
      copyFileSync(gatedScript, lonely)

      const result = spawnSync('/bin/bash', [lonely, built], {
        env: envFor(root),
        encoding: 'utf8'
      })

      expect(result.status, result.stderr).toBe(9)
      expect(result.stderr).toContain('semver-compare.py is missing')
      expect(result.stderr).not.toContain('no valid version')
      expect(asarOf(dest(root))).toBe('v1')
    })

    it('refuses with a clear reason when python3 is not on PATH (F4)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })
      // PATH with every system tool except python3.
      const bin = path.join(root, 'no-python-bin')
      mkdirSync(bin)
      for (const dir of ['/bin', '/usr/bin']) {
        for (const name of readdirSync(dir)) {
          if (!name.startsWith('python') && !existsSync(path.join(bin, name))) {
            symlinkSync(path.join(dir, name), path.join(bin, name))
          }
        }
      }

      const result = runGated(root, [built], { PATH: bin })

      expect(result.status, result.stderr).toBe(9)
      expect(result.stderr).toContain('python3 is not on PATH')
      expect(asarOf(dest(root))).toBe('v1')
    })
  }
)

describe('ignore rules (F3)', () => {
  // A worktree's node_modules is a symlink, which `node_modules/` (directories
  // only) does not match. A path that does not exist is judged as a non-directory
  // too, so it stands in for the symlink here.
  it.each([
    ['probe-dir/node_modules', '.gitignore:'],
    ['dobius/probe-dir/node_modules', 'dobius/.gitignore:']
  ])('ignores %s through %s', (rel, source) => {
    const result = spawnSync('git', ['-C', repoRoot, 'check-ignore', '--no-index', '-v', rel], {
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.startsWith(source)).toBe(true)
  })
})
