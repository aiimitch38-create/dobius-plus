// Approval screens agents must never operate (Codex P1 on 7.17). While one is
// open (the "From texts" review list, or the native Send confirm), Dobius+
// computer-use refuses every action aimed at Dobius+ itself, so ADAM cannot
// click Carson's Send for him. A hold is named so the same screen can release
// it, and a renderer that dies without releasing only over-protects.
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
