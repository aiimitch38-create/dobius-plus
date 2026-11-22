// `dobius tabs snooze|unsnooze|snoozed`. Snoozing runs in the window (it reads
// the tab's conversation while its terminal is alive), so main asks it.
// Bringing a tab back only marks its entry ready, exactly like its wake time
// coming due: the worktree's window then takes it through the snooze service's
// take(), the one claim gate, so a conversation is handed out and resumed once.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { checkExecutionAdmission } from '../../../agents/execution-gate'
import { CliActionError } from '../../../../shared/cli-action-errors'
import type { CliActionErrorCode } from '../../../../shared/cli-action-errors'
import {
  TAB_SNOOZE_CLI_MAX_MS,
  summarizeSnoozedTab,
  type SnoozedTabSummary
} from '../../../../shared/tab-snooze-cli'
import { getActiveTabSnoozeService } from '../../../tab-snooze-active'
import type { TabSnoozeService } from '../../../tab-snooze'
import { defineMethod, type RpcMethod } from '../core'

const REPLY_MESSAGE_MAX = 500
const ALLOWED_REPLY_CODES = new Set<string>([
  'tab_not_found',
  'tab_agent_working',
  'tab_snooze_refused',
  'tab_snooze_unavailable'
])

const TabId = z.string().trim().min(1, 'Missing tab id').max(512, 'tab id is too long')
const OptionalWorktree = z.string().trim().min(1).max(4096).optional()

const SnoozeParams = z.object({
  tab: TabId,
  until: z.union([z.number().finite(), z.null()]),
  force: z.boolean().optional()
})
const UnsnoozeParams = z.object({ tab: TabId, worktree: OptionalWorktree })
const SnoozedParams = z.object({ worktree: OptionalWorktree }).optional()

function service(): TabSnoozeService {
  const active = getActiveTabSnoozeService()
  if (!active) {
    throw new CliActionError('tab_snooze_unavailable', 'Snoozing is not running in this app.')
  }
  return active
}

export const TAB_SNOOZE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'tabs.snoozed',
    params: SnoozedParams,
    handler: async (params, { runtime }): Promise<{ tabs: SnoozedTabSummary[] }> => {
      const worktreeId = params?.worktree
        ? (await runtime.showManagedWorktree(params.worktree)).id
        : null
      return {
        tabs: service()
          .list()
          .filter((entry) => worktreeId === null || entry.worktreeId === worktreeId)
          .map(summarizeSnoozedTab)
      }
    }
  }),
  defineMethod({
    name: 'tabs.snooze',
    params: SnoozeParams,
    handler: async (params, { runtime }) => {
      const now = Date.now()
      if (params.until !== null && (params.until <= now || params.until - now > TAB_SNOOZE_CLI_MAX_MS)) {
        throw new CliActionError(
          'tab_snooze_refused',
          '--until must be in the future and within a year (or "manual" to wait until it is brought back).'
        )
      }
      const requestId = randomUUID()
      const reply = await runtime.requestTabSnooze({
        requestId,
        tabId: params.tab,
        until: params.until,
        ...(params.force ? { force: true } : {})
      })
      if (!reply) {
        throw new CliActionError('tab_snooze_unavailable', 'The Dobius+ window is not open, so nothing was snoozed.')
      }
      if (!reply.ok) {
        const code = ALLOWED_REPLY_CODES.has(reply.code) ? reply.code : 'tab_snooze_refused'
        throw new CliActionError(code as CliActionErrorCode, String(reply.message).slice(0, REPLY_MESSAGE_MAX))
      }
      return { worktreeId: reply.worktreeId, tabId: reply.tabId, until: params.until }
    }
  }),
  defineMethod({
    name: 'tabs.unsnooze',
    params: UnsnoozeParams,
    handler: async (params, { runtime }) => {
      const snooze = service()
      const worktreeId = params.worktree ? (await runtime.showManagedWorktree(params.worktree)).id : null
      const matches = snooze
        .list()
        .filter((entry) => entry.tabId === params.tab && (worktreeId === null || entry.worktreeId === worktreeId))
      if (matches.length === 0) {
        throw new CliActionError('tab_snooze_not_found', `no snoozed tab "${params.tab}". Run \`dobius tabs snoozed\`.`)
      }
      if (matches.length > 1) {
        throw new CliActionError(
          'tab_snooze_not_found',
          `${matches.length} snoozed tabs have id "${params.tab}"; pass --worktree to pick one.`
        )
      }
      const [entry] = matches
      if (entry.returning) {
        throw new CliActionError('tab_snooze_returning', 'That tab is already coming back; it will not be resumed twice.')
      }
      if (entry.agentSession || entry.launchAgent) {
        // Why: bringing it back resumes an agent, and Pause crew stops anything
        // autonomous from starting one.
        const admission = checkExecutionAdmission('agent-run')
        if (!admission.allowed) {
          throw new CliActionError('crew_paused', admission.message)
        }
      }
      // Why setTime(now) and not take(): take() belongs to the window that
      // reopens the tab. Marking it ready is what its wake time does; setTime
      // refuses an entry that is already returning, so this can never start a
      // second return.
      if (!snooze.setTime({ worktreeId: entry.worktreeId, tabId: entry.tabId }, Date.now())) {
        throw new CliActionError('tab_snooze_returning', 'That tab is already coming back; it will not be resumed twice.')
      }
      return {
        worktreeId: entry.worktreeId,
        tabId: entry.tabId,
        ready: true,
        message: 'Marked to come back. Its workspace window reopens it now, or as soon as that window is open.'
      }
    }
  })
]
