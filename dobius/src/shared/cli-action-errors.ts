// Error codes for the CLI-driven Board card, loop, snapshot and snooze actions
// (plan 9.8 batch E). Why a class with a code: `dobius ... --json` callers
// (ADAM, scripts) branch on error.code, so it must reach the CLI as the RPC
// error code, never as a generic runtime_error.
export const CLI_ACTION_ERROR_CODES = [
  'board_card_busy',
  'board_card_wrong_kind',
  'board_card_action_failed',
  'board_window_unavailable',
  'crew_paused',
  'loop_iteration_cap',
  'loop_not_found',
  'loop_invalid',
  'board_snapshot_not_found',
  'board_snapshot_unavailable',
  'tab_not_found',
  'tab_agent_working',
  'tab_snooze_refused',
  'tab_snooze_not_found',
  'tab_snooze_returning',
  'tab_snooze_unavailable'
] as const
export type CliActionErrorCode = (typeof CLI_ACTION_ERROR_CODES)[number]

export class CliActionError extends Error {
  constructor(
    readonly code: CliActionErrorCode,
    detail: string
  ) {
    super(`${code}: ${detail}`)
    this.name = 'CliActionError'
  }
}
