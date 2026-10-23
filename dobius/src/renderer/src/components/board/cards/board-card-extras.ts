import type { BoardCardBase, BoardState } from '@/store/slices/board'

type Rect = Pick<BoardCardBase, 'x' | 'y' | 'w' | 'h'>

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Pen strokes drawn over a card: the marks "Clear marks" removes from an image. */
export function strokeIdsOver(board: BoardState, target: Rect): string[] {
  return board.cards.filter((c) => c.kind === 'stroke' && overlaps(c, target)).map((c) => c.id)
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
