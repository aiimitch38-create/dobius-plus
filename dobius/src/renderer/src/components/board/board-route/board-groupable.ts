/** Selected card ids that can form a group: two or more cards of any kind, else null. */
export function groupableCardIds(
  cards: readonly { id: string }[],
  selectedIds: ReadonlySet<string>
): string[] | null {
  const ids = cards.filter((c) => selectedIds.has(c.id)).map((c) => c.id)
  return ids.length >= 2 ? ids : null
}
