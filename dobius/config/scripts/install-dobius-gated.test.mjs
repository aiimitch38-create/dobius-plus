// BUILD-043: the gated installer runs ONLY against temp fixture dirs here.
// Every run sets DOBIUS_INSTALL_DEST (never /Applications) and a temp HOME, so
// the script never quits, kills, relaunches or registers the real app.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const gatedScript = path.join(repoRoot, 'scripts', 'install-dobius-gated.sh')
const v2Script = path.join(repoRoot, 'scripts', 'install-dobius-v2.sh')
const buildAndInstall = path.join(repoRoot, 'build-and-install.sh')
const semverScript = path.join(repoRoot, 'scripts', 'semver-compare.py')

const roots = []

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'dobius-gated-install-'))
  roots.push(root)
  mkdirSync(path.join(root, 'home'))
  mkdirSync(path.join(root, 'Applications'))
  return root
}

function makeBundle(
  bundlePath,
  { version = '2.0.0', bundleVersion = null, asar = 'v1', withAsar = true } = {}
) {
  mkdirSync(path.join(bundlePath, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(path.join(bundlePath, 'Contents', 'Resources'), { recursive: true })
  const versionKey =
    version === null
      ? ''
      : `<key>CFBundleShortVersionString</key><string>${version}</string>\n`
  const bundleVersionKey =
    bundleVersion === null ? '' : `<key>CFBundleVersion</key><string>${bundleVersion}</string>\n`
  writeFileSync(
    path.join(bundlePath, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>FixtureApp</string>
<key>CFBundleIdentifier</key><string>com.example.dobius-installer-fixture</string>
${versionKey}${bundleVersionKey}</dict></plist>
`
  )
  // A real Mach-O (universal) binary so the arch validation runs for real.
  copyFileSync('/bin/echo', path.join(bundlePath, 'Contents', 'MacOS', 'FixtureApp'))
  chmodSync(path.join(bundlePath, 'Contents', 'MacOS', 'FixtureApp'), 0o755)
  if (withAsar) {
    writeFileSync(path.join(bundlePath, 'Contents', 'Resources', 'app.asar'), asar)
  }
  return bundlePath
}

function envFor(root, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: path.join(root, 'home'),
    USER: 'fixture',
    DOBIUS_INSTALL_DEST: path.join(root, 'Applications', 'Dobius+.app'),
    DOBIUS_INSTALL_LOCK: path.join(root, 'install.lock'),
    DOBIUS_INSTALL_LOCK_WAIT: '30',
    DOBIUS_INSTALL_BACKUP_DIR: path.join(root, 'backups'),
    DOBIUS_INSTALL_HISTORY_LOG: path.join(root, 'history.log'),
    ...extra
  }
}

function runGated(root, args, extraEnv) {
  const env = envFor(root, extraEnv)
  expect(env.DOBIUS_INSTALL_DEST.startsWith(root)).toBe(true)
  return spawnSync('/bin/bash', [gatedScript, ...args], { env, encoding: 'utf8' })
}

function runGatedAsync(root, args, extraEnv) {
  const env = envFor(root, extraEnv)
  expect(env.DOBIUS_INSTALL_DEST.startsWith(root)).toBe(true)
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [gatedScript, ...args], {
      env,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (status) => resolve({ status, stderr }))
  })
}

const dest = (root) => path.join(root, 'Applications', 'Dobius+.app')
const asarOf = (bundle) =>
  readFileSync(path.join(bundle, 'Contents', 'Resources', 'app.asar'), 'utf8')
const stageOf = (root) => path.join(root, 'Applications', 'Dobius+.new.app')

function expectPriorBundleKept(root, result) {
  expect(result.status).not.toBe(0)
  expect(asarOf(dest(root))).toBe('v1')
  expect(existsSync(stageOf(root))).toBe(false)
  expect(readdirSync(path.join(root, 'Applications'))).toEqual(['Dobius+.app'])
  expect(existsSync(path.join(root, 'install.lock'))).toBe(false)
  expect(existsSync(path.join(root, 'backups'))).toBe(false)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    // A uchg flag from the rename-failure case would block cleanup.
    spawnSync('chflags', ['-R', 'nouchg', root])
    chmodSync(root, 0o755)
    spawnSync('chmod', ['-R', 'u+rwX', root])
    rmSync(root, { recursive: true, force: true })
  }
})

// Why the long timeout: each run spawns bash, python3 and PlistBuddy several times,
// which takes seconds on a loaded machine.
describe.runIf(process.platform === 'darwin')(
  'install-dobius-gated.sh (fixture dirs only)',
  { timeout: 90_000 },
  () => {
    it('installs through a stage, keeps ONE rollback copy outside the install folder, and removes the dist copy', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      writeFileSync(path.join(dest(root), 'Contents', 'Resources', 'stale-from-v1.txt'), 'x')
      const built = makeBundle(
        path.join(root, 'repo', 'dobius', 'dist', 'mac-arm64', 'Dobius+.app'),
        {
          asar: 'v2'
        }
      )

      const result = runGated(root, [built])

      expect(result.status, result.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('v2')
      // The old bundle is replaced whole — no file from it survives (asar overwrite issue).
      expect(existsSync(path.join(dest(root), 'Contents', 'Resources', 'stale-from-v1.txt'))).toBe(
        false
      )
      const provenance = JSON.parse(
        readFileSync(
          path.join(dest(root), 'Contents', 'Resources', 'INSTALL-PROVENANCE.json'),
          'utf8'
        )
      )
      expect(provenance).toMatchObject({ branch: 'unknown', installedBy: 'fixture' })
      expect(readdirSync(path.join(root, 'backups'))).toEqual(['Dobius+.previous'])
      expect(asarOf(path.join(root, 'backups', 'Dobius+.previous'))).toBe('v1')
      expect(readdirSync(path.join(root, 'Applications'))).toEqual(['Dobius+.app'])
      // #105: no second same-bundle-ID app left in dist.
      expect(existsSync(built)).toBe(false)
      expect(existsSync(path.join(root, 'install.lock'))).toBe(false)
      expect(readFileSync(path.join(root, 'history.log'), 'utf8')).toMatch(
        /install unknown@unknown .*rollback: /
      )

      const next = makeBundle(
        path.join(root, 'repo', 'dobius', 'dist', 'mac-arm64', 'Dobius+.app'),
        {
          asar: 'v3'
        }
      )
      expect(runGated(root, [next]).status).toBe(0)
      expect(asarOf(dest(root))).toBe('v3')
      expect(readdirSync(path.join(root, 'backups'))).toEqual(['Dobius+.previous'])
      expect(asarOf(path.join(root, 'backups', 'Dobius+.previous'))).toBe('v2')
    })

    it('does a first install with no prior app and never deletes a bundle outside a dist/ folder', () => {
      const root = makeRoot()
      const handoff = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })

      const result = runGated(root, [handoff])

      expect(result.status, result.stderr).toBe(0)
      expect(asarOf(dest(root))).toBe('v2')
      expect(existsSync(handoff)).toBe(true)
      expect(existsSync(path.join(root, 'backups'))).toBe(false)
    })

    it('keeps the prior bundle when the copy fails', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(
        path.join(root, 'repo', 'dobius', 'dist', 'mac-arm64', 'Dobius+.app'),
        {
          asar: 'v2'
        }
      )
      const unreadable = path.join(built, 'Contents', 'Resources', 'unreadable.bin')
      writeFileSync(unreadable, 'secret')
      chmodSync(unreadable, 0o000)

      const result = runGated(root, [built])

      expectPriorBundleKept(root, result)
      expect(result.status).toBe(6)
      expect(existsSync(built)).toBe(true)
    })

    it('keeps the prior bundle when the staged build fails validation', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(
        path.join(root, 'repo', 'dobius', 'dist', 'mac-arm64', 'Dobius+.app'),
        {
          withAsar: false
        }
      )

      const result = runGated(root, [built])

      expectPriorBundleKept(root, result)
      expect(result.status).toBe(7)
      expect(result.stderr).toContain('app.asar missing')
      expect(existsSync(built)).toBe(true)
    })

    it('keeps the prior bundle when the swap rename fails', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(
        path.join(root, 'repo', 'dobius', 'dist', 'mac-arm64', 'Dobius+.app'),
        {
          asar: 'v2'
        }
      )
      // An immutable bundle cannot be renamed: the swap fails after staging succeeded.
      execFileSync('chflags', ['uchg', dest(root)])

      const result = runGated(root, [built])

      execFileSync('chflags', ['nouchg', dest(root)])
      expectPriorBundleKept(root, result)
      expect(result.status).toBe(8)
      expect(existsSync(built)).toBe(true)
    })

    it('takes the lock before the ownership and version checks (#104)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      writeFileSync(
        path.join(dest(root), 'Contents', 'Resources', 'INSTALL-PROVENANCE.json'),
        JSON.stringify({ branch: 'other-lane' })
      )
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })
      mkdirSync(path.join(root, 'install.lock'))

      const result = runGated(root, [built], { DOBIUS_INSTALL_LOCK_WAIT: '0' })

      // With the lock held, the installer must stop at the lock (4), not run the
      // ownership check (3) against state another install is about to change.
      expect(result.status, result.stderr).toBe(4)
      expect(asarOf(dest(root))).toBe('v1')
      expect(existsSync(path.join(root, 'install.lock'))).toBe(true)
    })

    it('serializes concurrent installers: copies never overlap and both finish', async () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const a = makeBundle(path.join(root, 'a', 'Dobius+.app'), { asar: 'va' })
      const b = makeBundle(path.join(root, 'b', 'Dobius+.app'), { asar: 'vb' })
      // Slow `cp` shim that records when each copy starts and ends.
      const shimDir = path.join(root, 'shim')
      const trace = path.join(root, 'cp-trace.log')
      mkdirSync(shimDir)
      writeFileSync(
        path.join(shimDir, 'cp'),
        `#!/bin/bash\necho "start $PPID" >> "${trace}"\nsleep 1\n/bin/cp "$@"; rc=$?\necho "end $PPID" >> "${trace}"\nexit $rc\n`
      )
      chmodSync(path.join(shimDir, 'cp'), 0o755)
      const env = { PATH: `${shimDir}:${process.env.PATH}` }

      const [ra, rb] = await Promise.all([
        runGatedAsync(root, [a], env),
        runGatedAsync(root, [b], env)
      ])

      expect(ra.status, ra.stderr).toBe(0)
      expect(rb.status, rb.stderr).toBe(0)
      const events = readFileSync(trace, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split(' ')[0])
      expect(events).toEqual(['start', 'end', 'start', 'end'])
      expect(['va', 'vb']).toContain(asarOf(dest(root)))
      expect(readdirSync(path.join(root, 'backups'))).toEqual(['Dobius+.previous'])
      expect(readdirSync(path.join(root, 'Applications'))).toEqual(['Dobius+.app'])
      expect(readFileSync(path.join(root, 'history.log'), 'utf8').trim().split('\n')).toHaveLength(
        2
      )
    })
  }
)

// Quit/kill/relaunch/LaunchServices normally run only for the real
// /Applications path. DOBIUS_INSTALL_TEST_MANAGE_APP forces them on for a
// fixture DEST, with every command replaced by a recorder shim first on PATH.
function withAppShims(root) {
  const shimDir = path.join(root, 'app-shims')
  const trace = path.join(root, 'app-trace.log')
  const destAsar = path.join(dest(root), 'Contents', 'Resources', 'app.asar')
  mkdirSync(shimDir)
  const shim = (name, exitCode) => {
    const file = path.join(shimDir, name)
    writeFileSync(
      file,
      `#!/bin/bash\nprintf '%s\\t%s\\t%s\\t%s\\n' "${name}" "$*" "$(cat "${destAsar}" 2>/dev/null)" "$([ -d "${stageOf(root)}" ] && echo staged || echo nostage)" >> "${trace}"\nexit ${exitCode}\n`
    )
    chmodSync(file, 0o755)
    return file
  }
  shim('osascript', 0)
  shim('pgrep', 1)
  shim('pkill', 0)
  shim('open', 0)
  const lsregister = shim('lsregister', 0)
  const env = {
    PATH: `${shimDir}:${process.env.PATH}`,
    DOBIUS_INSTALL_TEST_MANAGE_APP: '1',
    DOBIUS_INSTALL_LSREGISTER: lsregister
  }
  const read = () =>
    existsSync(trace)
      ? readFileSync(trace, 'utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const [cmd, args, destAsarAtCall, stage] = line.split('\t')
            return { cmd, args, destAsarAtCall, stage }
          })
      : []
  return { env, read }
}

describe.runIf(process.platform === 'darwin')(
  'install-dobius-gated.sh app management (recorder shims, fixture DEST)',
  { timeout: 90_000 },
  () => {
    it('validates the stage, then quits (with -a), swaps, and relaunches the new app', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })
      const shims = withAppShims(root)

      const result = runGated(root, [built], shims.env)

      expect(result.status, result.stderr).toBe(0)
      const calls = shims.read()
      expect(calls.map((c) => c.cmd)).toEqual([
        'osascript',
        'pgrep',
        'pkill',
        'pkill',
        'lsregister',
        'lsregister',
        'open'
      ])
      // Quit happens after the stage exists and before the swap.
      expect(calls[0]).toMatchObject({ stage: 'staged', destAsarAtCall: 'v1' })
      // An install run from a Dobius+ terminal descends from the main app:
      // without -a, pgrep/pkill silently skip it.
      expect(calls[1].args.split(' ')).toContain('-a')
      expect(calls[2].args).toBe('-a -x Dobius\\+')
      // Helpers only (--type=); the daemon's cmdline has no --type=.
      expect(calls[3].args).toBe('-f Dobius\\+ Helper.*--type=')
      expect(
        calls
          .filter((c) => c.cmd === 'pkill')
          .map((c) => c.args)
          .join(' ')
      ).not.toMatch(/daemon|Contents\/MacOS|\.app/)
      expect(calls[6]).toMatchObject({
        args: `-a ${path.join(realpathSync(root), 'Applications', 'Dobius+.app')}`,
        destAsarAtCall: 'v2'
      })
    })

    it('never quits the app when the build fails validation', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { withAsar: false })
      const shims = withAppShims(root)

      const result = runGated(root, [built], shims.env)

      expect(result.status).toBe(7)
      expect(shims.read()).toEqual([])
    })

    it('relaunches the unchanged app when the swap fails after quitting', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })
      const shims = withAppShims(root)
      execFileSync('chflags', ['uchg', dest(root)])

      const result = runGated(root, [built], shims.env)

      execFileSync('chflags', ['nouchg', dest(root)])
      expect(result.status).toBe(8)
      const calls = shims.read()
      expect(calls.map((c) => c.cmd)).toEqual(['osascript', 'pgrep', 'pkill', 'pkill', 'open'])
      expect(calls[4]).toMatchObject({
        args: `-a ${path.join(realpathSync(root), 'Applications', 'Dobius+.app')}`,
        destAsarAtCall: 'v1'
      })
      expect(asarOf(dest(root))).toBe('v1')
    })
  }
)

// BUILD-044 (#102): SemVer precedence, straight from the helper the installer calls.
const semver = (...args) => spawnSync('python3', [semverScript, ...args], { encoding: 'utf8' }).status

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

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.com'
    }
  }).trim()
}

// A real git repo whose build output sits in an ignored dist/, like dobius/.
function makeRepo(root) {
  const repo = path.join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(repo, '.gitignore'), 'dist/\n')
  writeFileSync(path.join(repo, 'src.txt'), 'committed\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'fixture')
  return repo
}

const provenanceOf = (bundle) =>
  JSON.parse(
    readFileSync(path.join(bundle, 'Contents', 'Resources', 'INSTALL-PROVENANCE.json'), 'utf8')
  )
const distBundle = (root, options) =>
  makeBundle(path.join(root, 'repo', 'dist', 'mac-arm64', 'Dobius+.app'), options)

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

    it('refuses a build with no version, even with --take-over (N8)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        version: null,
        asar: 'v2'
      })

      for (const args of [[built], [built, '--take-over']]) {
        const result = runGated(root, args)
        expect(result.status, result.stderr).toBe(5)
        expect(result.stderr).toContain('no valid version')
        expect(asarOf(dest(root))).toBe('v1')
      }
    })

    it('refuses to replace an installed app with no version unless --take-over (N8)', () => {
      const root = makeRoot()
      makeBundle(dest(root), { version: null, asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })

      const refused = runGated(root, [built])
      expect(refused.status, refused.stderr).toBe(5)
      expect(refused.stderr).toContain('cannot be proven not to be a downgrade')
      expect(asarOf(dest(root))).toBe('v1')

      const takenOver = runGated(root, [built, '--take-over'])
      expect(takenOver.status, takenOver.stderr).toBe(0)
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

      expect(dirtyEdit).toMatchObject({ dirty: true, tag: null, buildNumber: 42 })
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
  }
)

describe('retired install entry points (#100 #103 #112)', () => {
  const retired = [
    ['build-and-install.sh', buildAndInstall],
    ['scripts/install-dobius-v2.sh', v2Script]
  ]

  const installLogic = /\b(rm|cp|mv|ditto|rsync|pkill|osascript|open|exec|pnpm|electron-builder)\b/
  const codeOf = (body) =>
    body
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#') && !line.trimStart().startsWith('echo '))
      .join('\n')

  it.each(retired)('%s contains no install logic of its own', (_name, file) => {
    const body = readFileSync(file, 'utf8')
    const code = codeOf(body)
    expect(code).not.toMatch(installLogic)
    expect(code).toMatch(/^exit 1$/m)
    expect(body).toContain('scripts/install-dobius-gated.sh')
  })

  it.each(retired)('%s exits non-zero and points at the gated installer', (_name, file) => {
    // Only executed once the static check above proves it is a pointer — the
    // pre-BUILD-043 versions would really build and install.
    if (installLogic.test(codeOf(readFileSync(file, 'utf8')))) {
      throw new Error(`${file} still carries install logic; refusing to execute it`)
    }
    const result = spawnSync('/bin/bash', [file], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH }
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('scripts/install-dobius-gated.sh')
  })
})
