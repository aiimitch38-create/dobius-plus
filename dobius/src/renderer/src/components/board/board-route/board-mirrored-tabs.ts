export type MirroredTabCandidate = { id: string; launchAgent?: string }

/**
 * Host-backed launches return no tab id; the tab arrives later via the host
 * snapshot. Pick up to `needed` tabs that are new since the launch, not yet on
 * a card, and running the launched agent (when the tab reports one).
 */
export function pickMirroredTabs(
  tabs: readonly MirroredTabCandidate[],
  knownBefore: ReadonlySet<string>,
  claimed: ReadonlySet<string>,
  agent: string,
  needed: number
): string[] {
  return tabs
    .filter(
      (t) =>
        !knownBefore.has(t.id) &&
        !claimed.has(t.id) &&
        (t.launchAgent === undefined || t.launchAgent === agent)
    )
    .slice(0, Math.max(0, needed))
    .map((t) => t.id)
}
