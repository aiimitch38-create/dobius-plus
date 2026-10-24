import { translate } from '@/i18n/i18n'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
import {
  bulkStageRuntimeGitPaths,
  commitRuntimeGit,
  getRuntimeGitStatus
} from '@/runtime/runtime-git-client'
import { useAppStore } from '@/store'
import type { PlanEffects, StepResult } from './plan-execute'
import type { PlanConfirm } from './plan-effects-board'
import { planGitStep, type GitStepPlan, type GitStepProblem } from './plan-git'

// Board git steps run through the same runtime-aware client and store actions
// as Classic Source Control. Every step shows the exact commands and waits for
// an explicit confirmation; nothing is pushed without it.

const failed = (text: string): StepResult => ({ ok: false, text })

function problemText(problem: GitStepProblem): string {
  switch (problem) {
    case 'conflicts':
      return translate(
        'board.plan.git.conflicts',
        'This workspace has merge conflicts. Resolve them in Source Control first.'
      )
    case 'nothing-to-commit':
      return translate('board.plan.git.nothing', 'There is nothing to commit.')
    case 'no-message':
      return translate(
        'board.plan.git.noMessage',
        'Say the commit message, for example “commit with message fix the login test”.'
      )
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The git confirmation: the folder in words, then every command on its own line. */
export function gitConfirmOptions(
  plan: Pick<GitStepPlan, 'push' | 'commands'>,
  path: string
): Parameters<PlanConfirm>[0] {
  return {
    title: plan.push
      ? translate('board.plan.git.confirmPushTitle', 'Run these git commands and push?')
      : translate('board.plan.git.confirmTitle', 'Run these git commands?'),
    description: translate('board.plan.git.in', 'In {{path}}:', { path }),
    details: plan.commands,
    confirmLabel: plan.push
      ? translate('board.plan.git.confirmPush', 'Run and push')
      : translate('board.plan.git.confirmRun', 'Run'),
    confirmVariant: plan.push ? 'destructive' : 'default'
  }
}

export function gitEffect(worktreeId: string, confirm: PlanConfirm): PlanEffects['git'] {
  return async (action, message) => {
    const state = useAppStore.getState()
    const worktree = state.getKnownWorktreeById(worktreeId)
    if (!worktree?.path) {
      return failed(translate('board.plan.git.noWorktree', 'This workspace has no folder on disk.'))
    }
    const repo = state.repos.find((r) => r.id === worktree.repoId) ?? null
    const connectionId = repo?.connectionId ?? undefined
    const settings = getRepoOwnerRoutedSettings(state.settings, repo)
    const context = { settings, worktreeId, worktreePath: worktree.path, connectionId }
    let status
    try {
      status = await getRuntimeGitStatus(context)
    } catch (error) {
      return failed(errorText(error))
    }
    const planned = planGitStep({
      action,
      message,
      entries: status.entries,
      upstream: status.upstreamStatus ?? null,
      pushTarget: worktree.pushTarget
    })
    if (!planned.ok) {
      return failed(problemText(planned.problem))
    }
    const { plan } = planned
    const ok = await confirm(gitConfirmOptions(plan, worktree.path))
    if (!ok) {
      return failed(translate('board.plan.git.cancelled', 'Git cancelled; nothing ran.'))
    }
    const done: string[] = []
    try {
      if (plan.stagePaths.length > 0) {
        await bulkStageRuntimeGitPaths(context, plan.stagePaths)
        done.push(
          translate('board.plan.git.staged', 'staged {{count}} file(s)', {
            count: plan.stagePaths.length
          })
        )
      }
      if (plan.commitMessage) {
        const result = await commitRuntimeGit(context, plan.commitMessage)
        if (!result.success) {
          return failed(
            translate('board.plan.git.commitFailed', 'Commit failed: {{error}}', {
              error: result.error ?? ''
            })
          )
        }
        done.push(translate('board.plan.git.committed', 'committed'))
      }
      if (plan.push) {
        await state.pushBranch(
          worktreeId,
          worktree.path,
          !status.upstreamStatus?.hasUpstream,
          connectionId,
          worktree.pushTarget,
          { runtimeTargetSettings: settings }
        )
        done.push(translate('board.plan.git.pushed', 'pushed'))
      }
      if (plan.pull) {
        await state.pullBranch(worktreeId, worktree.path, connectionId, worktree.pushTarget, {
          runtimeTargetSettings: settings
        })
        done.push(translate('board.plan.git.pulled', 'pulled'))
      }
    } catch (error) {
      return failed(
        translate('board.plan.git.failedAfter', 'Git stopped ({{done}}): {{error}}', {
          done: done.join(', ') || translate('board.plan.git.nothingDone', 'nothing done'),
          error: errorText(error)
        })
      )
    }
    return {
      ok: true,
      text: translate('board.plan.git.done', 'Git: {{done}}.', { done: done.join(', ') })
    }
  }
}
