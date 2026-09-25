import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INSTALL_PROVENANCE_FILE,
  type SelfEditRepoRoot,
  bundleIdentity,
  installRecordPath,
  resolveSelfEditRepoRoot
} from './self-edit-repo-root'

// BUILD-044B: the installer keeps the install record outside the signed bundle.
const recordHelper = resolve(import.meta.dirname, '../../../../scripts/install-record.py')

/** A checkout with an app folder (`<repo>/dobius/package.json`). */
function checkout(): { repo: string; app: string } {
  const repo = mkdtempSync(join(tmpdir(), 'selfedit-record-repo-'))
  const app = join(repo, 'dobius')
  mkdirSync(app)
  writeFileSync(join(app, 'package.json'), '{}\n')
  return { repo, app }
}

/** A packaged bundle; returns its Contents/Resources folder. */
function bundle(buildNumber: string, options: { seal?: string; legacy?: string } = {}): string {
  const root = join(mkdtempSync(join(tmpdir(), 'selfedit-record-bundle-')), 'Dobius+.app')
  const resources = join(root, 'Contents', 'Resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    join(root, 'Contents', 'Info.plist'),
    `<plist><dict><key>CFBundleVersion</key><string>${buildNumber}</string></dict></plist>\n`
  )
  if (options.seal !== undefined) {
    mkdirSync(join(root, 'Contents', '_CodeSignature'))
    writeFileSync(join(root, 'Contents', '_CodeSignature', 'CodeResources'), options.seal)
  }
  if (options.legacy !== undefined) {
    writeFileSync(join(resources, INSTALL_PROVENANCE_FILE), options.legacy)
  }
  return resources
}

const bundleOf = (resourcesPath: string): string => resolve(resourcesPath, '..', '..')

function homeWithRecord(record: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), 'selfedit-record-home-'))
  mkdirSync(dirname(installRecordPath(home)), { recursive: true })
  writeFileSync(installRecordPath(home), JSON.stringify(record))
  return home
}

function packaged(home: string, resourcesPath: string): SelfEditRepoRoot {
  return resolveSelfEditRepoRoot({ isPackaged: true, env: {}, home, resourcesPath })
}

function pythonIdentity(bundlePath: string): string {
  const result = spawnSync('python3', [recordHelper, 'identity', bundlePath], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

describe('resolveSelfEditRepoRoot install record outside the bundle (BUILD-044B)', () => {
  it('uses the installer record when it names this bundle', () => {
    const { repo, app } = checkout()
    const resources = bundle('41')
    const home = homeWithRecord({ repo, bundleIdentity: bundleIdentity(bundleOf(resources)) })
    expect(packaged(home, resources)).toEqual({ ok: true, root: app })
  })

  it('prefers the matching outside record over a stale record inside the bundle', () => {
    const current = checkout()
    const stale = checkout()
    const resources = bundle('41', { legacy: JSON.stringify({ repo: stale.repo }) })
    const home = homeWithRecord({
      repo: current.repo,
      bundleIdentity: bundleIdentity(bundleOf(resources))
    })
    expect(packaged(home, resources)).toEqual({ ok: true, root: current.app })
  })

  it('ignores an outside record of another bundle and falls back to the legacy record', () => {
    const other = checkout()
    const legacy = checkout()
    const otherBundle = bundle('40')
    const home = homeWithRecord({
      repo: other.repo,
      bundleIdentity: bundleIdentity(bundleOf(otherBundle))
    })

    const legacyResources = bundle('41', { legacy: JSON.stringify({ repo: legacy.repo }) })
    expect(packaged(home, legacyResources)).toEqual({ ok: true, root: legacy.app })

    const noRecord = packaged(home, bundle('41'))
    expect(noRecord.ok).toBe(false)
    expect(noRecord.ok ? '' : noRecord.error).toMatch(/no provenance stamp/)
  })

  it('refuses a matching outside record without a repo instead of reading another record', () => {
    const legacy = checkout()
    const resources = bundle('41', { legacy: JSON.stringify({ repo: legacy.repo }) })
    const home = homeWithRecord({ repo: '', bundleIdentity: bundleIdentity(bundleOf(resources)) })
    const result = packaged(home, resources)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/no readable repo path/)
  })

  it('computes the same bundle identity as scripts/install-record.py', () => {
    const unsigned = bundleOf(bundle('41'))
    const signed = bundleOf(bundle('41', { seal: '<plist>seal of build 41</plist>\n' }))
    const resealed = bundleOf(bundle('41', { seal: '<plist>another seal</plist>\n' }))

    expect(bundleIdentity(unsigned)).toBe(pythonIdentity(unsigned))
    expect(bundleIdentity(signed)).toBe(pythonIdentity(signed))
    expect(bundleIdentity(signed)).not.toBe(bundleIdentity(unsigned))
    expect(bundleIdentity(signed)).not.toBe(bundleIdentity(resealed))
    expect(bundleIdentity(bundleOf(bundle('42')))).not.toBe(bundleIdentity(unsigned))
    expect(bundleIdentity(join(tmpdir(), 'no-such-bundle.app'))).toBeNull()
  })
})
