// Approval screens agents should not operate (7.17). While one is open (the
// "From texts" review list, or the native Send confirm), Dobius+ computer-use
// refuses actions and snapshots aimed at Dobius+ itself.
// DEFENSE IN DEPTH ONLY: the main renderer can lift its own hold, and an agent
// with a shell can script clicks without computer-use. Sending a text is gated
// by Touch ID (text-intake-wiring.ts), which neither can pass. A hold is named
// so its own screen releases it; a renderer that dies only over-protects.
import type { ComputerListWindowsResult } from '../../shared/computer-use-runtime-types'

const holds = new Set<string>()

export function holdProtectedSelfUi(key: string): void {
  holds.add(key)
}

export function releaseProtectedSelfUi(key: string): void {
  holds.delete(key)
}

export function protectedSelfUiActive(): boolean {
  return holds.size > 0
}

export function resetProtectedSelfUiForTest(): void {
  holds.clear()
}

/** Runs `work` with a hold held, released afterwards even when it throws. */
export async function withProtectedSelfUi<T>(key: string, work: () => Promise<T>): Promise<T> {
  holdProtectedSelfUi(key)
  try {
    return await work()
  } finally {
    releaseProtectedSelfUi(key)
  }
}

/** Sync check used when a queued action finally runs: by name or pid only. */
export function namesSelf(app: unknown, selfPid: number = process.pid): boolean {
  return typeof app === 'string' && (SELF_NAME.test(app) || app.trim() === String(selfPid))
}

// Why a name check too: when the window list cannot be read, the target is
// unknown, so anything that names Dobius+ (or the dev build's "Electron") is refused.
const SELF_NAME = /dobius|electron/i

export const PROTECTED_SELF_UI_REASON =
  'Dobius+ is showing an approval screen (texts waiting for Carson). Agents may not click, type or press keys in Dobius+ while it is open; Carson does this himself.'

/** True when an action on `app` would land in Dobius+ itself. */
export async function targetsSelf(
  app: unknown,
  listWindows: (params: { app: unknown }) => Promise<ComputerListWindowsResult>,
  selfPid: number = process.pid
): Promise<boolean> {
  if (typeof app === 'string' && SELF_NAME.test(app)) {
    return true
  }
  try {
    const listed = await listWindows({ app })
    const pids = [listed?.app?.pid, ...(listed?.windows ?? []).map((window) => window.app?.pid)]
    return pids.includes(selfPid)
  } catch {
    // An unreadable window list with no Dobius-like name: not provably us.
    return false
  }
}
