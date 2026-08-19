// get_git_identity + discover_git_bash_prerequisite: small, self-contained
// environment probes with no reposDir/projectDtag involvement, so neither
// needs the path-safety helpers in paths.ts.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { runGit } from './git-exec'
import { commandExecFileAsync } from '../../git/runner'

export type GitIdentity = { name: string | null; email: string | null }

async function readGlobalGitConfig(key: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(['config', '--global', '--get', key], homedir())
    const value = stdout.trim()
    return value.length > 0 ? value : null
  } catch {
    // `git config --get` exits 1 (not 0) when the key isn't set — that's a
    // normal "no identity configured yet" outcome, not a failure to report.
    return null
  }
}

/** The viewer's configured git identity (`git config --global user.name/user.email`). */
export async function getGitIdentity(): Promise<GitIdentity> {
  const [name, email] = await Promise.all([
    readGlobalGitConfig('user.name'),
    readGlobalGitConfig('user.email')
  ])
  return { name, email }
}

export type GitBashPrerequisite = {
  available: boolean
  path: string | null
  installInstructionsUrl: string
  installHint: string
}

const GIT_BASH_INSTALL_URL = 'https://git-scm.com/download/win'
const GIT_BASH_INSTALL_HINT =
  'Install Git for Windows, which bundles Git Bash — needed for a POSIX-compatible shell on Windows.'

const WINDOWS_GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
]

/**
 * Discovers whether Git Bash is available. This is a Windows-only concept —
 * Dobius runs it to decide whether it can offer a POSIX shell for a git
 * recovery terminal on Windows. Elsewhere it correctly reports "not
 * applicable" (null) instead of fabricating a Windows-shaped answer.
 */
export async function discoverGitBashPrerequisite(): Promise<GitBashPrerequisite | null> {
  if (process.platform !== 'win32') {
    return null
  }
  for (const candidate of WINDOWS_GIT_BASH_CANDIDATES) {
    if (existsSync(candidate)) {
      return {
        available: true,
        path: candidate,
        installInstructionsUrl: GIT_BASH_INSTALL_URL,
        installHint: GIT_BASH_INSTALL_HINT
      }
    }
  }
  try {
    const { stdout } = await commandExecFileAsync('where', ['bash.exe'], { timeout: 5_000 })
    const found = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().includes('git') && line.length > 0)
    if (found) {
      return {
        available: true,
        path: found,
        installInstructionsUrl: GIT_BASH_INSTALL_URL,
        installHint: GIT_BASH_INSTALL_HINT
      }
    }
  } catch {
    // `where` exits non-zero when nothing matches — fall through to "not available".
  }
  return {
    available: false,
    path: null,
    installInstructionsUrl: GIT_BASH_INSTALL_URL,
    installHint: GIT_BASH_INSTALL_HINT
  }
}
