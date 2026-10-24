import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useBoardCameraFocus } from './board-focus-state'

const FLASH_MS = 600

/**
 * Focus-mode marker for any card: keeps the card out of the 60% dim
 * (`data-board-focus-target`) and flashes the accent ring once on arrival.
 * Consoles draw the same ring from their own status edge; the two overlap exactly.
 */
export function BoardCardFocusEdge({ cardId }: { cardId: string }): React.JSX.Element | null {
  const inFocus = useBoardCameraFocus((s) => s.focus?.cardIds.includes(cardId) ?? false)
  const arrivedAt = useBoardCameraFocus((s) =>
    s.focus?.cardIds.includes(cardId) ? s.focus.arrivedAt : 0
  )
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!arrivedAt) {
      return
    }
    setFlashing(true)
    const timer = window.setTimeout(() => setFlashing(false), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [arrivedAt])
  if (!inFocus) {
    return null
  }
  return (
    <span
      aria-hidden
      data-board-focus-target=""
      className={cn(
        'pointer-events-none absolute inset-0 z-10 rounded-(--board-radius-card) transition-[border-color,box-shadow] duration-200',
        flashing
          ? 'border-2 border-[var(--board-accent)] shadow-[0_0_0_4px_var(--board-accent-tint)]'
          : 'border-0'
      )}
    />
  )
}
