import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '../../../../../shared/git-status-types'
import { planGitStep } from './plan-git'

const entry = (path: string, area: GitStatusEntry['area']): GitStatusEntry => ({
  path,
  area,
  status: area === 'untracked' ? 'untracked' : 'modified'
})
const upstream = { hasUpstream: true, upstreamName: 'origin/feature', ahead: 1, behind: 0 }

describe('planGitStep', () => {
  it('commits only what is staged, then pushes to the upstream', () => {
    const r = planGitStep({
      action: 'commit_push',
      message: 'Fix the "login" test',
      entries: [entry('a.ts', 'staged'), entry('b.ts', 'unstaged')],
      upstream
    })
    expect(r).toEqual({
      ok: true,
      plan: {
        stagePaths: [],
        commitMessage: 'Fix the "login" test',
        push: true,
        pull: false,
        commands: [
          'git commit -m "Fix the \\"login\\" test"',
          'git push --set-upstream origin HEAD:feature'
        ]
      }
    })
  })

  it('stages every change first when nothing is staged, and shows the add', () => {
    const r = planGitStep({
      action: 'commit',
      message: 'wip',
      entries: [entry('a.ts', 'unstaged'), entry('my file.ts', 'untracked')],
      upstream
    })
    expect(r.ok && r.plan.stagePaths).toEqual(['a.ts', 'my file.ts'])
    expect(r.ok && r.plan.commands).toEqual(['git add -- a.ts "my file.ts"', 'git commit -m "wip"'])
    expect(r.ok && r.plan.push).toBe(false)
  })

  it('refuses without a message, with nothing to commit, or with conflicts', () => {
    expect(
      planGitStep({ action: 'commit', message: null, entries: [entry('a', 'staged')], upstream })
    ).toEqual({ ok: false, problem: 'no-message' })
    expect(planGitStep({ action: 'commit_push', message: 'x', entries: [], upstream })).toEqual({
      ok: false,
      problem: 'nothing-to-commit'
    })
    expect(
      planGitStep({
        action: 'pull',
        message: null,
        entries: [{ ...entry('a', 'unstaged'), conflictStatus: 'unresolved' }],
        upstream
      })
    ).toEqual({ ok: false, problem: 'conflicts' })
  })

  it('publishes a branch with no upstream and honours an explicit push target', () => {
    const noUpstream = planGitStep({
      action: 'push',
      message: null,
      entries: [],
      upstream: { hasUpstream: false, ahead: 0, behind: 0 }
    })
    expect(noUpstream.ok && noUpstream.plan.commands).toEqual([
      'git push --set-upstream origin HEAD'
    ])
    const pull = planGitStep({
      action: 'pull',
      message: null,
      entries: [],
      upstream,
      pushTarget: { remoteName: 'fork', branchName: 'topic' }
    })
    expect(pull.ok && pull.plan.commands).toEqual(['git pull fork topic'])
  })
})
