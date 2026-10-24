type Placed = { id: string; x: number; y: number; w: number; h: number }

/**
 * Reading order (left to right, top to bottom). A card joins the current row
 * while its top sits above the middle of that row's first card, so consoles
 * that are only a few px out of line still read as one row.
 */
export function boardReadingOrder<T extends Placed>(cards: readonly T[]): T[] {
  const byTop = [...cards].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: T[][] = []
  let rowLimit = -Infinity
  for (const card of byTop) {
    const row = rows.at(-1)
    if (row && card.y < rowLimit) {
      row.push(card)
      continue
    }
    rows.push([card])
    rowLimit = card.y + card.h / 2
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x))
}

/** The id `step` places away from `currentId` (wrapping); the first/last when none is current. */
export function boardStepId(
  orderedIds: readonly string[],
  currentId: string | null,
  step: 1 | -1
): string | null {
  if (orderedIds.length === 0) {
    return null
  }
  const at = currentId ? orderedIds.indexOf(currentId) : -1
  if (at === -1) {
    return (step === 1 ? orderedIds[0] : orderedIds.at(-1)) ?? null
  }
  return orderedIds[(at + step + orderedIds.length) % orderedIds.length]
}

type Steppable = Placed & { kind: string; shape?: string }

/**
 * Cards ⌥←/→ visits: every window on the board in reading order, minus pen
 * ink and line/arrow connectors (marks on the board, not places to go).
 */
export function boardFocusStepOrder<T extends Steppable>(cards: readonly T[]): T[] {
  return boardReadingOrder(
    cards.filter(
      (c) =>
        c.kind !== 'stroke' && !(c.kind === 'shape' && (c.shape === 'line' || c.shape === 'arrow'))
    )
  )
}
