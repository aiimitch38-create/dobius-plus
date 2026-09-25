// BUILD-045 (#101): the gated installer refuses a bundle that is missing a
// build-graph artifact, before it quits the app. Fixture dirs only (see
// install-dobius-gated-fixtures.mjs): DOBIUS_INSTALL_DEST never points at
// /Applications and HOME is a temp dir.
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MANIFEST_DISK_FILES,
  MANIFEST_EXECUTABLES,
  asarOf,
  cleanupRoots,
  dest,
  envFor,
  gatedScript,
  makeBundle,
  makeRoot,
  repoRoot,
  runGated,
  stageOf
} from './install-dobius-gated-fixtures.mjs'

const manifestScript = path.join(repoRoot, 'scripts', 'bundle-manifest.py')
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'dobius', 'package.json'), 'utf8'))
const ADAM_CLI_PATH = 'Contents/Resources/app.asar.unpacked/out/cli/index.js'

function checkManifest(bundle) {
  return spawnSync('python3', [manifestScript, bundle], { encoding: 'utf8' })
}

afterEach(cleanupRoots)

describe.runIf(process.platform === 'darwin')(
  'bundle-manifest.py (#101)',
  { timeout: 60_000 },
  () => {
    it('accepts a bundle with every build-graph artifact', () => {
      const root = makeRoot()
      const bundle = makeBundle(path.join(root, 'complete', 'Dobius+.app'))

      const result = checkManifest(bundle)

      expect(result.status, result.stdout + result.stderr).toBe(0)
      expect(result.stdout).toBe('')
    })

    it.each([
      [ADAM_CLI_PATH, 'build:cli'],
      ['Contents/Resources/relay/linux-x64/relay.js', 'build:relay'],
      ['Contents/Resources/relay/darwin-arm64/.version', 'build:relay'],
      ['out/web/web-index.html', 'build:web'],
      ['out/main/index.js', 'build:electron-vite'],
      [
        'Contents/Resources/Dobius+ Computer Use.app/Contents/MacOS/dobius-computer-use-macos',
        'build:native'
      ],
      ['Contents/Resources/bin/dobius', 'electron-builder extraResources'],
      [
        'Contents/Frameworks/Electron Framework.framework/Versions/A/_CodeSignature/CodeResources',
        'electron-builder'
      ]
    ])('reports a bundle missing %s (from %s)', (omitted, step) => {
      const root = makeRoot()
      const bundle = makeBundle(path.join(root, 'partial', 'Dobius+.app'), { omit: [omitted] })

      const result = checkManifest(bundle)

      expect(result.status).toBe(1)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`(from ${step}`)
      expect(lines[0]).toContain(path.basename(omitted))
    })

    it('reports an empty file and a non-executable CLI shim', () => {
      const root = makeRoot()
      const bundle = makeBundle(path.join(root, 'broken', 'Dobius+.app'))
      writeFileSync(path.join(bundle, ADAM_CLI_PATH), '')
      chmodSync(path.join(bundle, 'Contents/Resources/bin/dobius'), 0o644)

      const result = checkManifest(bundle)

      expect(result.status).toBe(1)
      expect(result.stdout).toContain(`${ADAM_CLI_PATH} (from build:cli)`)
      expect(result.stdout).toContain(
        'bin/dobius (from electron-builder extraResources, must be executable)'
      )
    })

    it('reports an app.asar that is not an asar archive instead of crashing', () => {
      const root = makeRoot()
      const bundle = makeBundle(path.join(root, 'bad-asar', 'Dobius+.app'))
      writeFileSync(path.join(bundle, 'Contents/Resources/app.asar'), 'not an archive')

      const result = checkManifest(bundle)

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('app.asar is not a readable asar archive')
    })

    it('covers every path the fixture builds (fixture and manifest stay in sync)', () => {
      const root = makeRoot()
      for (const rel of [...MANIFEST_DISK_FILES, ...MANIFEST_EXECUTABLES]) {
        const bundle = makeBundle(
          path.join(root, `omit-${readdirSync(root).length}`, 'Dobius+.app'),
          {
            omit: [rel]
          }
        )
        expect(checkManifest(bundle).status, rel).toBe(1)
      }
    })
  }
)

describe.runIf(process.platform === 'darwin')(
  'install-dobius-gated.sh artifact manifest (#101, fixture dirs only)',
  { timeout: 90_000 },
  () => {
    it('refuses a bundle without out/cli/index.js before touching the installed app', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        asar: 'v2',
        omit: [ADAM_CLI_PATH]
      })

      const result = runGated(root, [built])

      expect(result.status).toBe(7)
      expect(result.stderr).toContain('Missing build artifacts:')
      expect(result.stderr).toContain(`${ADAM_CLI_PATH} (from build:cli)`)
      expect(result.stderr).toContain('incomplete build')
      expect(asarOf(dest(root))).toBe('v1')
      expect(existsSync(stageOf(root))).toBe(false)
      expect(readdirSync(path.join(root, 'Applications'))).toEqual(['Dobius+.app'])
      expect(existsSync(path.join(root, 'install.lock'))).toBe(false)
      expect(existsSync(built)).toBe(true)
    })

    it('never quits the app when the bundle is incomplete', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), {
        asar: 'v2',
        omit: ['out/web/web-index.html']
      })
      const shimDir = path.join(root, 'shims')
      const trace = path.join(root, 'trace.log')
      mkdirSync(shimDir)
      for (const name of ['osascript', 'pgrep', 'pkill', 'open', 'lsregister']) {
        writeFileSync(path.join(shimDir, name), `#!/bin/bash\necho ${name} >> "${trace}"\n`, {
          mode: 0o755
        })
      }

      const result = runGated(root, [built], {
        PATH: `${shimDir}:${process.env.PATH}`,
        DOBIUS_INSTALL_TEST_MANAGE_APP: '1',
        DOBIUS_INSTALL_LSREGISTER: path.join(shimDir, 'lsregister')
      })

      expect(result.status).toBe(7)
      expect(result.stderr).toContain('app.asar:out/web/web-index.html (from build:web)')
      expect(existsSync(trace)).toBe(false)
      expect(asarOf(dest(root))).toBe('v1')
    })

    it('refuses with exit 9 when bundle-manifest.py is not beside the installer', () => {
      const root = makeRoot()
      makeBundle(dest(root), { asar: 'v1' })
      const built = makeBundle(path.join(root, 'handoff', 'Dobius+.app'), { asar: 'v2' })
      const dir = path.join(root, 'no-manifest')
      mkdirSync(dir)
      for (const name of ['install-dobius-gated.sh', 'semver-compare.py', 'source-state.py']) {
        copyFileSync(path.join(path.dirname(gatedScript), name), path.join(dir, name))
      }

      const result = spawnSync('/bin/bash', [path.join(dir, 'install-dobius-gated.sh'), built], {
        env: envFor(root),
        encoding: 'utf8'
      })

      expect(result.status, result.stderr).toBe(9)
      expect(result.stderr).toContain('bundle-manifest.py is missing')
      expect(asarOf(dest(root))).toBe('v1')
    })
  }
)

// The manifest is only useful if the one build command produces everything it
// checks: build:unpack must run the full graph (#101 — the retired
// build-and-install.sh skipped build:cli/relay/web/native).
describe('build:unpack graph (#101)', () => {
  const scripts = packageJson.scripts

  it('runs the full build (desktop + native) before packaging', () => {
    expect(scripts['build:unpack']).toMatch(/&& pnpm run build && .*--dir$/)
    expect(scripts.build).toBe('pnpm run build:desktop && pnpm run build:native')
    for (const step of ['build:relay', 'build:electron-vite', 'build:web', 'build:cli']) {
      expect(scripts['build:desktop'], step).toContain(`pnpm run ${step}`)
    }
  })
})
