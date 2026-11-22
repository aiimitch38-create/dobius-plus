import type { HandlerContext } from './dispatch'
import { RuntimeClientError } from './runtime-client'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from './selectors'

export async function getGitWorktreeSelector({
  flags,
  cwd,
  client
}: HandlerContext): Promise<string> {
  const worktree = flags.get('worktree')
  if (flags.has('worktree') && (typeof worktree !== 'string' || worktree.length === 0)) {
    throw new RuntimeClientError('invalid_argument', 'Missing value for --worktree.')
  }
  const explicit = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
  if (explicit) {
    return explicit
  }
  if (client.isRemote) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Remote git and PR commands require --worktree because the client folder cannot identify a server worktree.'
    )
  }
  return await resolveCurrentWorktreeSelector(cwd, client)
}

// Why: `--flag=true` parses as the string "true", so a strict `=== true`
// check would silently ignore it (for --dry-run that means committing anyway).
export function getSwitchFlag(flags: Map<string, string | boolean>, name: string): boolean {
  if (!flags.has(name)) {
    return false
  }
  const value = flags.get(name)
  if (value === true || value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  throw new RuntimeClientError('invalid_argument', `--${name} takes no value.`)
}

export function getPrNumberFlag(flags: Map<string, string | boolean>): number | undefined {
  if (!flags.has('pr')) {
    return undefined
  }
  const value = flags.get('pr')
  const prNumber = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(prNumber)) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--pr needs a pull request number, like --pr 42.'
    )
  }
  return prNumber
}
