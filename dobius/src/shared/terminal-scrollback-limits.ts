export const TERMINAL_SCROLLBACK_SESSION_BUFFER_BYTE_LIMIT = 512 * 1024
export const TERMINAL_SCROLLBACK_REPLAY_BYTE_LIMIT = 512 * 1024
export const TERMINAL_SCROLLBACK_STORE_BYTE_LIMIT = 5 * 1024 * 1024
// Why: this is a soft row-reduction target, not an absolute snapshot maximum.
export const MOBILE_SNAPSHOT_BYTE_BUDGET = 512 * 1024
// Why: bound binary snapshot admission and client assembly without claiming
// every legal terminal buffer fits. Oversized snapshots use the Error frame.
export const TERMINAL_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024
