import type { PRCheckDetail, PRCheckRunDetails, PRComment, PRInfo } from '../shared/types'
import { plural, safeText } from './git-format'

const MAX_COMMENT_BODY_CHARS = 1500
const MAX_LOG_TAIL_CHARS = 4000

export function formatPullRequest(pr: PRInfo | null, branch: string): string {
  if (!pr) {
    return safeText(`No pull request found for branch ${branch}.`)
  }
  const lines = [
    `PR #${pr.number}: ${pr.title}`,
    `  State:    ${pr.state}`,
    `  Checks:   ${pr.checksStatus}`
  ]
  if (pr.reviewDecision) {
    lines.push(`  Review:   ${pr.reviewDecision}`)
  }
  lines.push(`  Mergeable: ${pr.mergeable}`)
  if (pr.baseRefName) {
    lines.push(`  Into:     ${pr.baseRefName}`)
  }
  lines.push(`  Link:     ${pr.url}`)
  return safeText(lines.join('\n'))
}

function checkLabel(check: PRCheckDetail): string {
  if (check.status !== 'completed') {
    return check.status === 'queued' ? 'queued' : 'running'
  }
  return check.conclusion ?? 'done'
}

export function formatPullRequestChecks(result: {
  prNumber: number
  checks: PRCheckDetail[]
}): string {
  if (result.checks.length === 0) {
    return `PR #${result.prNumber} has no checks.`
  }
  const failing = result.checks.filter((c) =>
    ['failure', 'timed_out', 'cancelled', 'action_required'].includes(c.conclusion ?? '')
  ).length
  const lines = [
    `PR #${result.prNumber}: ${plural(result.checks.length, 'check')}, ${failing} failing`
  ]
  for (const check of result.checks) {
    lines.push(`  ${checkLabel(check).padEnd(16)}${check.name}${check.url ? `  ${check.url}` : ''}`)
  }
  if (failing > 0) {
    lines.push('', 'For one check\'s errors and log: dobius pr checks --check "<name>"')
  }
  return safeText(lines.join('\n'))
}

function tail(text: string, max: number): string {
  return text.length > max ? `...${text.slice(text.length - max)}` : text
}

export function formatPullRequestCheckDetails(details: PRCheckRunDetails | null): string {
  if (!details) {
    return 'No details are available for that check.'
  }
  const lines = [
    `Check: ${details.name}`,
    `  Result: ${details.conclusion ?? details.status ?? 'unknown'}`
  ]
  if (details.url ?? details.detailsUrl) {
    lines.push(`  Link:   ${details.url ?? details.detailsUrl}`)
  }
  if (details.title) {
    lines.push('', details.title)
  }
  if (details.summary) {
    lines.push('', tail(details.summary, MAX_LOG_TAIL_CHARS))
  }
  if (details.annotations.length > 0) {
    lines.push('', 'Errors reported:')
    for (const note of details.annotations) {
      const where = note.path ? `${note.path}${note.startLine ? `:${note.startLine}` : ''}: ` : ''
      lines.push(`  ${where}${note.message}`)
    }
  }
  for (const job of details.jobs) {
    const failedSteps = job.steps.filter((s) => s.conclusion === 'failure').map((s) => s.name)
    lines.push('', `Job ${job.name}: ${job.conclusion ?? job.status ?? 'unknown'}`)
    if (failedSteps.length > 0) {
      lines.push(`  Failed steps: ${failedSteps.join(', ')}`)
    }
    if (job.logTail) {
      lines.push('  End of log:', tail(job.logTail, MAX_LOG_TAIL_CHARS))
    }
  }
  return safeText(lines.join('\n'))
}

export function formatPullRequestComments(result: {
  prNumber: number
  comments: PRComment[]
}): string {
  if (result.comments.length === 0) {
    return `PR #${result.prNumber} has no comments.`
  }
  const lines = [`PR #${result.prNumber}: ${plural(result.comments.length, 'comment')}`]
  for (const comment of result.comments) {
    const where = comment.path ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ''}` : ''
    const state =
      comment.threadId === undefined ? '' : comment.isResolved ? ' [resolved]' : ' [open]'
    const body =
      comment.body.length > MAX_COMMENT_BODY_CHARS
        ? `${comment.body.slice(0, MAX_COMMENT_BODY_CHARS)}... (pass --json for the full text)`
        : comment.body
    lines.push(
      '',
      `${comment.author}${comment.isBot ? ' (bot)' : ''}${where}${state}, ${comment.createdAt.slice(0, 10)}`,
      ...body.split('\n').map((line) => `  ${line}`)
    )
  }
  return safeText(lines.join('\n'))
}

export function formatPullRequestCreated(result: { number: number; url: string }): string {
  return safeText(`Opened PR #${result.number}: ${result.url}`)
}
