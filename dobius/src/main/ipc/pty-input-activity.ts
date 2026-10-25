// Why: the "recent user input" clock for a PTY is written by the renderer's
// pty:write IPC (ipc/pty.ts) but read by main-side automation (the lead
// watcher must never replace a console someone is typing into). Keeping the
// map in its own dependency-free module lets that automation read it without
// importing the Electron-bound PTY module.

/** performance.now() of the last renderer-originated write per PTY id. */
export const lastInputAtByPty = new Map<string, number>()

export function ptyLastInputAt(ptyId: string): number | undefined {
  return lastInputAtByPty.get(ptyId)
}
