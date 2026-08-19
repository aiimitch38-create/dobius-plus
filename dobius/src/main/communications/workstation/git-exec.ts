// Thin, workstation-scoped wrapper around the existing git execFile runner
// (src/main/git/runner.ts). Reusing gitExecFileAsync means every command here
// inherits its non-interactive env handling and its execFile-not-shell
// invocation (no shell string ever gets built from untrusted input).
import { gitExecFileAsync, nonInteractiveGitEnv } from '../../git/runner'

export type GitExecResult = { stdout: string; stderr: string }

/**
 * Rejects values that could be parsed as a flag instead of a positional
 * argument (argv flag smuggling — e.g. a branch name of `--upload-pack=...`
 * reaching `git clone <url>`). Every renderer-supplied ref/URL/branch name
 * passed to git in this feature is checked with this before use, in addition
 * to a literal `--` end-of-options marker in the argv itself.
 */
export function assertNotFlagLike(value: string, field: string): string {
  if (value.startsWith('-')) {
    throw new Error(`${field} must not start with "-"`)
  }
  return value
}

const DEFAULT_TIMEOUT_MS = 30_000
const NETWORK_TIMEOUT_MS = 120_000

/** Runs a local (non-network) git command inside `cwd`. Never touches a remote. */
export async function runGit(
  args: readonly string[],
  cwd: string,
  options: { timeout?: number } = {}
): Promise<GitExecResult> {
  return gitExecFileAsync([...args], {
    cwd,
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
    env: nonInteractiveGitEnv()
  })
}

/** Runs a git command that talks to a remote (clone/fetch/push/pull/ls-remote). */
export async function runGitNetwork(
  args: readonly string[],
  cwd: string,
  options: { timeout?: number } = {}
): Promise<GitExecResult> {
  return gitExecFileAsync([...args], {
    cwd,
    timeout: options.timeout ?? NETWORK_TIMEOUT_MS,
    env: nonInteractiveGitEnv()
  })
}
