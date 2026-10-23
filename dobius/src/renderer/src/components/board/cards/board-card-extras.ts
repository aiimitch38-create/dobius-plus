import type { BoardCardBase, BoardState } from '@/store/slices/board'

type Rect = Pick<BoardCardBase, 'x' | 'y' | 'w' | 'h'>

// Why center-inside, not overlap: a long stroke that only crosses the image is not a mark on it.
const centerInside = (a: Rect, b: Rect): boolean => {
  const cx = a.x + a.w / 2
  const cy = a.y + a.h / 2
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h
}

/** Pen strokes drawn over a card: the marks "Clear marks" removes from an image. */
export function strokeIdsOver(board: BoardState, target: Rect): string[] {
  return board.cards.filter((c) => c.kind === 'stroke' && centerInside(c, target)).map((c) => c.id)
}

/** CLI-neutral request to run a skill (Claude, Codex and others all accept plain wording). */
export function buildSkillRunPrompt(skillName: string, args: string): string {
  const trimmed = args.trim()
  return trimmed
    ? `Use the "${skillName}" skill with these arguments: ${trimmed}`
    : `Use the "${skillName}" skill.`
}

/** Case-insensitive substring filter, local branches first (no "/" remote prefix). */
export function filterBranches(refs: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  const hits = q ? refs.filter((r) => r.toLowerCase().includes(q)) : [...refs]
  return hits.sort(
    (a, b) => Number(a.includes('/')) - Number(b.includes('/')) || a.localeCompare(b)
  )
}
