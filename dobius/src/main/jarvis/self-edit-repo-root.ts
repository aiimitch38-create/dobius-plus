import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, parse, resolve } from 'node:path'
import { readSafeJsonFile } from '../storage/safe-json-file'

export type SelfEditRepoRoot = { ok: true; root: string } | { ok: false; error: string }

/** Stamped into the packaged app by scripts/install-dobius-gated.sh. */
export const INSTALL_PROVENANCE_FILE = 'INSTALL-PROVENANCE.json'

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
  const provenancePath = join(resourcesPath, INSTALL_PROVENANCE_FILE)
  const provenance = readSafeJsonFile<string | null>(
    provenancePath,
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined
      }
      const repo = (raw as { repo?: unknown }).repo
      return typeof repo === 'string' && repo.trim() ? repo.trim() : undefined
    },
    () => null
  )
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
