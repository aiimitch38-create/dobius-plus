// BUILD-043: the gated installer runs ONLY against temp fixture dirs here.
// Every run sets DOBIUS_INSTALL_DEST (never /Applications) and a temp HOME, so
// the script never quits, kills, relaunches or registers the real app.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  asarOf,
  asarTagCommand,
  cleanupRoots,
  dest,
  makeBundle,
  makeRoot,
  repoRoot,
  runGated,
  runGatedAsync,
  stageOf
} from './install-dobius-gated-fixtures.mjs'

const v2Script = path.join(repoRoot, 'scripts', 'install-dobius-v2.sh')
const buildAndInstall = path.join(repoRoot, 'build-and-install.sh')

function expectPriorBundleKept(root, result) {
  expect(result.status).not.toBe(0)
  expect(asarOf(dest(root))).toBe('v1')
  expect(existsSync(stageOf(root))).toBe(false)
  expect(readdirSync(path.join(root, 'Applications'))).toEqual(['Dobius+.app'])
  expect(existsSync(path.join(root, 'install.lock'))).toBe(false)
  expect(existsSync(path.join(root, 'backups'))).toBe(false)
}

afterEach(cleanupRoots)

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
      `#!/bin/bash\nprintf '%s\\t%s\\t%s\\t%s\\n' "${name}" "$*" "$(${asarTagCommand(destAsar)} 2>/dev/null)" "$([ -d "${stageOf(root)}" ] && echo staged || echo nostage)" >> "${trace}"\nexit ${exitCode}\n`
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
