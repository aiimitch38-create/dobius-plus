export type BoardKillTarget = { cardId: string; tabId: string }

/** Card ids whose terminal tab no longer exists in any worktree. */
export function boardCardsWithClosedTabs(
  targets: readonly BoardKillTarget[],
  tabsByWorktree: Readonly<Record<string, readonly { id: string }[]>>
): string[] {
  const live = new Set(Object.values(tabsByWorktree).flatMap((tabs) => tabs.map((t) => t.id)))
  return targets.filter((t) => !live.has(t.tabId)).map((t) => t.cardId)
}
