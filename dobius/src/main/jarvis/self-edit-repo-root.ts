import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, parse, resolve } from 'node:path'
import { readSafeJsonFile } from '../storage/safe-json-file'

export type SelfEditRepoRoot = { ok: true; root: string } | { ok: false; error: string }

/**
 * The install record scripts/install-dobius-gated.sh keeps. Since BUILD-044B it
 * lives outside the bundle (writing into the signed bundle broke its code
 * signature); installs from before that have it in Contents/Resources.
 */
export const INSTALL_PROVENANCE_FILE = 'INSTALL-PROVENANCE.json'

/** Where the installer keeps the installed app's record (its CURRENT_REC). */
export function installRecordPath(home: string): string {
  return join(
    home,
    'Library',
    'Application Support',
    'dobius-plus-install-backups',
    INSTALL_PROVENANCE_FILE
  )
}

/**
 * The value the installer stores as `bundleIdentity`; must match
 * `bundle_identity` in scripts/install-record.py byte for byte.
 */
export function bundleIdentity(bundle: string): string | null {
  const digest = createHash('sha256')
  try {
    const plist = readFileSync(join(bundle, 'Contents', 'Info.plist'))
    digest.update(Buffer.concat([Buffer.from('Info.plist\0'), plist]))
  } catch {
    return null
  }
  const seal = join(bundle, 'Contents', '_CodeSignature', 'CodeResources')
  if (existsSync(seal)) {
    try {
      digest.update(Buffer.concat([Buffer.from('\0CodeResources\0'), readFileSync(seal)]))
    } catch {
      return null
    }
  }
  return `sha256:${digest.digest('hex')}`
}

const NOT_CONFIGURED =
  "No Dobius+ source folder is configured. Set DOBIUS_SELF_EDIT_REPO_ROOT to the checkout's dobius folder and restart."

/**
 * The Dobius+ app folder (`<checkout>/dobius`) Adam may rewrite, from explicit
 * configuration only.
 *
 * Why not app.getAppPath(): two parents of it is the bundle's `Contents` folder
 * when packaged and the folder ABOVE the checkout in dev, so neither is the repo.
 * Order: DOBIUS_SELF_EDIT_REPO_ROOT; then in dev DOBIUS_DEV_REPO_ROOT (set by
 * run-electron-vite-dev.mjs to this checkout's app folder); when packaged,
 * `<repo>/dobius` from the installer's provenance stamp. With none of them,
 * self-edit refuses rather than guessing a folder.
 */
export function resolveSelfEditRepoRoot(options: {
  isPackaged: boolean
  env: NodeJS.ProcessEnv
  home: string
  resourcesPath: string
}): SelfEditRepoRoot {
  const { isPackaged, env, home, resourcesPath } = options
  const explicit = env.DOBIUS_SELF_EDIT_REPO_ROOT?.trim()
  if (explicit) {
    return validateRepoRoot(explicit, 'DOBIUS_SELF_EDIT_REPO_ROOT', home)
  }
  if (!isPackaged) {
    const devRoot = env.DOBIUS_DEV_REPO_ROOT?.trim()
    return devRoot
      ? validateRepoRoot(devRoot, 'DOBIUS_DEV_REPO_ROOT', home)
      : { ok: false, error: `Self-edit is off: ${NOT_CONFIGURED}` }
  }
  const provenance = readInstallRecordRepo(home, resourcesPath)
  if (provenance.status !== 'ok' || !provenance.value) {
    const why =
      provenance.status === 'missing'
        ? 'this install has no provenance stamp'
        : 'the install provenance stamp has no readable repo path'
    return { ok: false, error: `Self-edit is off: ${why}. ${NOT_CONFIGURED}` }
  }
  const repo = provenance.value
  return validateRepoRoot(
    isAbsolute(repo) ? join(repo, 'dobius') : repo,
    'the install provenance stamp',
    home
  )
}

/**
 * The repo from this bundle's install record: the installer's record outside
 * the bundle when its bundleIdentity names THIS bundle (so a record left by
 * another install, or read by a copy running from dist, is never used), else
 * the legacy record inside the bundle.
 */
function readInstallRecordRepo(home: string, resourcesPath: string) {
  const identity = bundleIdentity(resolve(resourcesPath, '..', '..'))
  const sidecar = readSafeJsonFile<{ repo: string | null } | null>(
    installRecordPath(home),
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined
      }
      const record = raw as { bundleIdentity?: unknown; repo?: unknown }
      return identity !== null && record.bundleIdentity === identity
        ? { repo: repoOf(record.repo) }
        : null
    },
    () => null
  )
  if (sidecar.status === 'ok' && sidecar.value) {
    return sidecar.value.repo
      ? { status: 'ok' as const, value: sidecar.value.repo }
      : { status: 'unreadable' as const, value: null }
  }
  return readSafeJsonFile<string | null>(
    join(resourcesPath, INSTALL_PROVENANCE_FILE),
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined
      }
      return repoOf((raw as { repo?: unknown }).repo) ?? undefined
    },
    () => null
  )
}

function repoOf(repo: unknown): string | null {
  return typeof repo === 'string' && repo.trim() ? repo.trim() : null
}

function validateRepoRoot(configured: string, source: string, home: string): SelfEditRepoRoot {
  if (!isAbsolute(configured)) {
    return {
      ok: false,
      error: `Self-edit is off: the source folder from ${source} is not an absolute path.`
    }
  }
  const root = resolve(configured)
  // Why: a filesystem or home root would make nearly every file on the machine editable.
  if (root === parse(root).root || root === resolve(home)) {
    return {
      ok: false,
      error: `Self-edit is off: "${root}" (from ${source}) is too broad to be the Dobius+ source folder.`
    }
  }
  if (!isDirectory(root) || !existsSync(join(root, 'package.json'))) {
    return {
      ok: false,
      error: `Self-edit is off: "${root}" (from ${source}) is not a Dobius+ app folder with a package.json.`
    }
  }
  return { ok: true, root }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
