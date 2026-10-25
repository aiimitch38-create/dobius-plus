import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { getRequiredWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'

type LeadStatusEntry = {
  worktreeId: string
  repoPath: string
  profile: string
  projectId: string
  running: boolean
  autostart: boolean
  halted: boolean
  launchFailures: number
  seenCount: number
  lastPollAt: number | null
  lastError: string | null
}

type LeadInitResult = {
  worktreeId: string
  repoPath: string
  wrote: { orchestrator: boolean; leadConfig: boolean }
  profile: string
  projectId: string
  warnings?: string[]
}

type LeadStopResult = { worktreeId: string; stopped: boolean }

type LeadStatusResult = { watchers: LeadStatusEntry[] }

async function worktreeSelector(ctx: HandlerContext): Promise<string> {
  const { flags, cwd, client } = ctx
  return flags.has('worktree')
    ? await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    : await resolveCurrentWorktreeSelector(cwd, client)
}

function formatStatusEntry(entry: LeadStatusEntry): string {
  const state = entry.halted
    ? `HALTED after ${entry.launchFailures} failed launches`
    : entry.running
      ? 'running'
      : 'stopped'
  const autostart = entry.autostart ? 'autostart on' : 'autostart off'
  const polled = entry.lastPollAt ? new Date(entry.lastPollAt).toISOString() : 'never'
  const error = entry.lastError ? ` last error: ${entry.lastError}` : ''
  return `${entry.profile} (${entry.projectId}) ${state}, ${autostart}, on ${entry.repoPath} · seen ${entry.seenCount} · last poll ${polled}${error}`
}

function formatStatus(result: LeadStatusResult): string {
  if (result.watchers.length === 0) {
    return 'No lead watchers running.'
  }
  return result.watchers.map(formatStatusEntry).join('\n')
}

export const LEAD_HANDLERS: Record<string, CommandHandler> = {
  'lead init': async (ctx) => {
    const worktree = await worktreeSelector(ctx)
    const result = await ctx.client.call<LeadInitResult>('lead.init', { worktree })
    printResult(result, ctx.json, (value) => {
      const lines = [
        `Lead ${value.profile} for project ${value.projectId} at ${value.repoPath}`,
        `.dobius/ORCHESTRATOR.md: ${value.wrote.orchestrator ? 'written' : 'already present'}`,
        `.dobius/lead.json: ${value.wrote.leadConfig ? 'written' : 'already present'}`,
        ...(value.warnings ?? []).map((warning) => `Warning: ${warning}`)
      ]
      return lines.join('\n')
    })
  },
  'lead start': async (ctx) => {
    const worktree = await worktreeSelector(ctx)
    const result = await ctx.client.call<LeadStatusEntry>('lead.start', { worktree })
    printResult(result, ctx.json, formatStatusEntry)
  },
  'lead stop': async (ctx) => {
    const worktree = await worktreeSelector(ctx)
    const result = await ctx.client.call<LeadStopResult>('lead.stop', { worktree })
    printResult(result, ctx.json, (value) =>
      value.stopped ? `Stopped lead watcher for ${value.worktreeId}` : 'No lead watcher was running.'
    )
  },
  'lead status': async (ctx) => {
    const worktree = ctx.flags.has('worktree') ? await worktreeSelector(ctx) : undefined
    const result = await ctx.client.call<LeadStatusResult>('lead.status', { worktree })
    printResult(result, ctx.json, formatStatus)
  }
}
