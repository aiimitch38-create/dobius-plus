// Pure geometry + wiring rules for the Board's links layer: orchestrator cables
// and card-to-card arrows. Rects are world coordinates. No DOM, no store.
import type { BoardCard, BoardConnector, BoardGroup, BoardState } from '@/store/slices/board'
import { boundsOf, type Rect } from '../cards/card-geometry'

// Why: must match GroupFrame's padding so a cable meets the visible frame edge.
export const GROUP_FRAME_PADDING = 24

export type BoardPointXY = { x: number; y: number }
export type BoardCable = {
  id: string
  from: Rect
  to: Rect
  /** The card the cable starts at: an orchestrator, or a goal card. */
  orchestratorId: string
  targetTabIds: string[]
}
export type BoardArrow = { id: string; from: Rect; to: Rect; connector: BoardConnector }

const center = (r: Rect): BoardPointXY => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Where the line from `r`'s centre toward `toward` leaves `r`'s border. */
export function rectExitPoint(r: Rect, toward: BoardPointXY): BoardPointXY {
  const c = center(r)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) {
    return c
  }
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

/** Border-to-border endpoints for a link between two rects. */
export function linkEndpoints(from: Rect, to: Rect): { start: BoardPointXY; end: BoardPointXY } {
  return { start: rectExitPoint(from, center(to)), end: rectExitPoint(to, center(from)) }
}

/** Gentle S-curve so parallel cables stay readable. */
export function linkPath(start: BoardPointXY, end: BoardPointXY): string {
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
  const bend = Math.max(
    24,
    (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) / 2
  )
  const c1 = horizontal
    ? { x: start.x + Math.sign(end.x - start.x) * bend, y: start.y }
    : { x: start.x, y: start.y + Math.sign(end.y - start.y) * bend }
  const c2 = horizontal
    ? { x: end.x - Math.sign(end.x - start.x) * bend, y: end.y }
    : { x: end.x, y: end.y - Math.sign(end.y - start.y) * bend }
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`
}

export function groupFrameRect(group: BoardGroup, cards: readonly BoardCard[]): Rect | null {
  const members = new Set(group.cardIds)
  return boundsOf(
    cards.filter((c) => members.has(c.id)),
    GROUP_FRAME_PADDING
  )
}

/**
 * Cables from each orchestrator to what it commands. A group whose every
 * console is wired gets one cable to its frame instead of one per member.
 */
export function orchestratorCables(board: Pick<BoardState, 'cards' | 'groups'>): BoardCable[] {
  const byId = new Map(board.cards.map((c) => [c.id, c]))
  const cables: BoardCable[] = []
  for (const card of board.cards) {
    if (card.kind !== 'orchestrator') {
      continue
    }
    const wired = new Set(card.wiredCardIds.filter((id) => byId.get(id)?.kind === 'console'))
    const covered = new Set<string>()
    for (const group of board.groups) {
      const consoles = group.cardIds.filter((id) => byId.get(id)?.kind === 'console')
      const rect = groupFrameRect(group, board.cards)
      if (consoles.length > 0 && rect && consoles.every((id) => wired.has(id))) {
        consoles.forEach((id) => covered.add(id))
        cables.push({
          id: `${card.id}->group:${group.id}`,
          from: card,
          to: rect,
          orchestratorId: card.id,
          targetTabIds: consoles.flatMap((id) => consoleTabIds(byId.get(id)))
        })
      }
    }
    for (const id of wired) {
      if (!covered.has(id)) {
        cables.push({
          id: `${card.id}->${id}`,
          from: card,
          to: byId.get(id)!,
          orchestratorId: card.id,
          targetTabIds: consoleTabIds(byId.get(id))
        })
      }
    }
  }
  return cables
}

/**
 * Cables from each goal card to what it is wired to: consoles, orchestrator
 * cards, and group frames (a goal wires the group itself, so new members get it too).
 */
export function goalCables(board: Pick<BoardState, 'cards' | 'groups'>): BoardCable[] {
  const byId = new Map(board.cards.map((c) => [c.id, c]))
  const groups = new Map(board.groups.map((g) => [g.id, g]))
  return board.cards.flatMap((card) =>
    card.kind !== 'goal'
      ? []
      : card.wiredCardIds.flatMap((id): BoardCable[] => {
          const group = groups.get(id)
          const rect = group ? groupFrameRect(group, board.cards) : null
          if (group && rect) {
            return [
              {
                id: `${card.id}->group:${id}`,
                from: card,
                to: rect,
                orchestratorId: card.id,
                targetTabIds: group.cardIds.flatMap((m) => consoleTabIds(byId.get(m)))
              }
            ]
          }
          const target = byId.get(id)
          return target?.kind === 'console' || target?.kind === 'orchestrator'
            ? [
                {
                  id: `${card.id}->${id}`,
                  from: card,
                  to: target,
                  orchestratorId: card.id,
                  targetTabIds: consoleTabIds(target)
                }
              ]
            : []
        })
  )
}

function consoleTabIds(card: BoardCard | undefined): string[] {
  return card?.kind === 'console' ? [card.tabId] : []
}

export function connectorArrows(board: Pick<BoardState, 'cards' | 'connectors'>): BoardArrow[] {
  const byId = new Map(board.cards.map((c) => [c.id, c]))
  return (board.connectors ?? []).flatMap((connector) => {
    const from = byId.get(connector.fromCardId)
    const to = byId.get(connector.toCardId)
    return from && to ? [{ id: connector.id, from, to, connector }] : []
  })
}

/**
 * Connect-mode click on a console or group: wires the targets, or unwires them
 * when every target is already wired (so a second click on a group pill disconnects it).
 */
export function toggleWired(
  wiredCardIds: readonly string[],
  targetIds: readonly string[]
): string[] {
  if (targetIds.length === 0) {
    return [...wiredCardIds]
  }
  const wired = new Set(wiredCardIds)
  if (targetIds.every((id) => wired.has(id))) {
    const drop = new Set(targetIds)
    return wiredCardIds.filter((id) => !drop.has(id))
  }
  return [...wiredCardIds, ...targetIds.filter((id) => !wired.has(id))]
}
