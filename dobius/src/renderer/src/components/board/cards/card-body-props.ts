import type { BoardCardOf, BoardCardKind, BoardCardPatch } from '@/store/slices/board'

export type CardBodyProps<K extends BoardCardKind> = {
  card: BoardCardOf<K>
  onChange: (patch: BoardCardPatch) => void
}

export function newItemId(): string {
  return crypto.randomUUID()
}
