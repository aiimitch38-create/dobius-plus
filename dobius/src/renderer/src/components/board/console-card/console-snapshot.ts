// Best-effort still image of a portaled terminal, shown while the card is
// zoomed far out or off-screen and its live pane is handed back.

export function captureTerminalSnapshot(host: HTMLElement | null): string | null {
  const canvases = host ? Array.from(host.querySelectorAll('canvas')) : []
  const visible = canvases.filter((c) => c.width > 0 && c.height > 0)
  if (visible.length === 0) {
    return null
  }
  const width = Math.max(...visible.map((c) => c.width))
  const height = Math.max(...visible.map((c) => c.height))
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  if (!ctx) {
    return null
  }
  try {
    // Why: xterm stacks text/selection/cursor layers; composite them in DOM order.
    for (const canvas of visible) {
      ctx.drawImage(canvas, 0, 0)
    }
    return out.toDataURL('image/png')
  } catch (error) {
    // A tainted or lost WebGL context just means "no snapshot"; the card shows its cover instead.
    console.debug('[board-console] snapshot failed', error)
    return null
  }
}
