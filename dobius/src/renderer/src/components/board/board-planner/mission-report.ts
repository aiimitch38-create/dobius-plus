import type { BoardThreadReport } from '../board-command-bar/BoardThread'
import { replyExcerpt, type Mission } from '../board-delivery/mission-state'

/**
 * One finished mission -> one thread report row. The agent label comes from the
 * console card on that tab (falls back to the lane name); the row's own
 * "See output" viewer handles copy and save to outputs/.
 */
export function missionReport(
  mission: Pick<Mission, 'tabId' | 'name' | 'reply' | 'finishedAt'>,
  consoles: readonly { tabId: string; agentKind: string }[],
  now: number
): BoardThreadReport {
  return {
    agent: consoles.find((c) => c.tabId === mission.tabId)?.agentKind ?? mission.name,
    consoleTitle: mission.name,
    excerpt: replyExcerpt(mission.reply),
    full: mission.reply ?? '',
    at: mission.finishedAt ?? now
  }
}
