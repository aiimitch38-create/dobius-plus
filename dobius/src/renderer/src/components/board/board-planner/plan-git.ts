import type { GitStatusEntry, GitUpstreamStatus } from '../../../../../shared/git-status-types'
import type { GitPushTarget } from '../../../../../shared/types'
import type { PlanGit } from './plan-schema'

// Works out exactly which git commands a Board git step will run, from the
// worktree's live status. Pure, so the confirmation dialog can show the real
// commands and tests can pin them. Mirrors the Classic Source Control actions:
// stage (git add), commit -m, push --set-upstream, pull.

export type GitStepPlan = {
  /** Paths to stage first; only when nothing was staged. */
  stagePaths: string[]
  commitMessage: string | null
  push: boolean
  pull: boolean
  /** The commands, one per line, as the user should read them before confirming. */
  commands: string[]
}

export type GitStepProblem = 'conflicts' | 'nothing-to-commit' | 'no-message'

const MAX_LISTED_PATHS = 6

function quote(text: string): string {
  return `"${text.replace(/(["\\$`])/g, '\\$1')}"`
}

function addCommand(paths: readonly string[]): string {
  const listed = paths.slice(0, MAX_LISTED_PATHS).map((p) => (/\s/.test(p) ? quote(p) : p))
  const more = paths.length - listed.length
  return `git add -- ${listed.join(' ')}${more > 0 ? ` (+${more} more)` : ''}`
}

function pushCommand(upstream: GitUpstreamStatus | null, pushTarget?: GitPushTarget): string {
  if (pushTarget) {
    return `git push --set-upstream ${pushTarget.remoteName} HEAD:${pushTarget.branchName}`
  }
  const name = upstream?.hasUpstream ? upstream.upstreamName : undefined
  const slash = name ? name.indexOf('/') : -1
  return name && slash > 0
    ? `git push --set-upstream ${name.slice(0, slash)} HEAD:${name.slice(slash + 1)}`
    : 'git push --set-upstream origin HEAD'
}

function pullCommand(pushTarget?: GitPushTarget): string {
  return pushTarget ? `git pull ${pushTarget.remoteName} ${pushTarget.branchName}` : 'git pull'
}

export function planGitStep(input: {
  action: PlanGit
  message: string | null
  entries: readonly GitStatusEntry[]
  upstream: GitUpstreamStatus | null
  pushTarget?: GitPushTarget
}): { ok: true; plan: GitStepPlan } | { ok: false; problem: GitStepProblem } {
  const { action, entries, upstream, pushTarget } = input
  const commits = action === 'commit' || action === 'commit_push'
  const push = action === 'push' || action === 'commit_push'
  const pull = action === 'pull'
  if (entries.some((e) => e.conflictStatus === 'unresolved')) {
    return { ok: false, problem: 'conflicts' }
  }
  let stagePaths: string[] = []
  let commitMessage: string | null = null
  const commands: string[] = []
  if (commits) {
    // Submodule-internal rows are never stageable from the parent.
    const own = entries.filter((e) => !e.submoduleRoot)
    const staged = own.filter((e) => e.area === 'staged')
    if (staged.length === 0) {
      stagePaths = [...new Set(own.map((e) => e.path))]
      if (stagePaths.length === 0) {
        return { ok: false, problem: 'nothing-to-commit' }
      }
      commands.push(addCommand(stagePaths))
    }
    commitMessage = input.message?.trim() || null
    if (!commitMessage) {
      return { ok: false, problem: 'no-message' }
    }
    commands.push(`git commit -m ${quote(commitMessage)}`)
  }
  if (push) {
    commands.push(pushCommand(upstream, pushTarget))
  }
  if (pull) {
    commands.push(pullCommand(pushTarget))
  }
  return { ok: true, plan: { stagePaths, commitMessage, push, pull, commands } }
}
