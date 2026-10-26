import type { PtyConnectionDeps } from './pty-connection-types'

export type PaneStartup = NonNullable<PtyConnectionDeps['startup']>
export type RequeueableStartup = Omit<PaneStartup, 'waitForSetupSplitDirection'>

/**
 * Why: TerminalPane captures the queued startup command on its first render
 * and consumes it from the store at once, and connectPanePty moves it into a
 * closure. A pane that is remounted before that connect issued its spawn (a
 * Board console card re-homes its pane between the inline host and its portal
 * slot during the first frames, while the connect is still waiting for a
 * stable startup grid) therefore starts a bare shell: the command died with
 * the disposed closure and the remount found an empty queue. Deciding here
 * whether the torn-down connect must hand the command back keeps that rule
 * in one testable place.
 */
export function shouldRequeueStartupOnDispose(args: {
  startup: PaneStartup | null
  spawnBound: boolean
  tabStillOpen: boolean
}): boolean {
  return args.startup !== null && !args.spawnBound && args.tabStillOpen
}

/** The payload handed back to `queueTabStartupCommand`: the setup-split wait is
 *  re-derived by the next mount, and the launch token keeps the already
 *  registered launch config identity so delayed prompt delivery still matches. */
export function startupToRequeue(
  startup: PaneStartup,
  launchToken: string | undefined
): RequeueableStartup {
  const { waitForSetupSplitDirection: _ignored, ...rest } = startup
  const token = launchToken ?? rest.launchToken
  return token ? { ...rest, launchToken: token } : rest
}
