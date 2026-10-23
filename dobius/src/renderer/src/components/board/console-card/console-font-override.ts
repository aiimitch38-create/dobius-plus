// Board -> TerminalPane channel for a per-pane font size. The Board publishes
// the font that keeps a console's grid constant at the current zoom; a
// TerminalPane that renders that pane applies it (fontSize + fit) and calls
// markBoardConsoleFontOverrideSupported() once, which switches the Board from
// plain scaling to crisp counter-scaling.
// Not consumed yet: TerminalPane is outside the Board's files (see report).

const overrides = new Map<string, number>()
const listeners = new Set<(paneKey: string, fontSize: number | null) => void>()
let supported = false

export function isBoardConsoleFontOverrideSupported(): boolean {
  return supported
}

export function markBoardConsoleFontOverrideSupported(): void {
  supported = true
}

export function setBoardConsoleFontOverride(paneKey: string, fontSize: number | null): void {
  if ((overrides.get(paneKey) ?? null) === fontSize) {
    return
  }
  if (fontSize === null) {
    overrides.delete(paneKey)
  } else {
    overrides.set(paneKey, fontSize)
  }
  for (const listener of listeners) {
    listener(paneKey, fontSize)
  }
}

export function getBoardConsoleFontOverride(paneKey: string): number | null {
  return overrides.get(paneKey) ?? null
}

export function onBoardConsoleFontOverride(
  listener: (paneKey: string, fontSize: number | null) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetBoardConsoleFontOverridesForTest(): void {
  overrides.clear()
  listeners.clear()
  supported = false
}
