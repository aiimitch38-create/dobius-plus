// Why: an opaque Board-colored layer at the same position and z-index as
// BoardRoute/BoardHome. It stands in while a Board chunk is still loading and
// during startup, so the Classic shell underneath is never painted.
export function BoardSurfaceCover(): React.JSX.Element {
  return (
    <div
      data-surface="board"
      data-testid="board-surface-cover"
      aria-hidden
      className="fixed inset-0 z-40 bg-[var(--board-canvas)]"
    />
  )
}
