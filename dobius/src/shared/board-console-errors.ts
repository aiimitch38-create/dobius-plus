// Why: `dobius board send` / `card:<title>` / `tab:<tabId>` callers branch on these codes, so
// they must reach the CLI as the RPC error code, not as generic runtime_error.
export const BOARD_CONSOLE_ERROR_CODES = [
  'board_card_not_found',
  'board_card_ambiguous',
  'board_card_not_running',
  'board_card_pane_unclear',
  // `tab:<tabId>` addresses (9.4): same rule, never a fallback terminal.
  'terminal_tab_not_found',
  'terminal_tab_not_running',
  'terminal_tab_pane_unclear'
] as const
export type BoardConsoleErrorCode = (typeof BOARD_CONSOLE_ERROR_CODES)[number]

export class BoardConsoleError extends Error {
  constructor(
    readonly code: BoardConsoleErrorCode,
    detail: string
  ) {
    super(`${code}: ${detail}`)
    this.name = 'BoardConsoleError'
  }
}
