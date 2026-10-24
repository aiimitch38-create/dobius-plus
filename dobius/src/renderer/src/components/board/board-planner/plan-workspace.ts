// Picks the workspace a planner step names, against the Board's workspace list.

/** "next", "previous", a 1-based position, or a name. */
export function pickWorkspace<T extends { id: string; name: string }>(
  list: readonly T[],
  currentId: string,
  target: string
): T | undefined {
  const index = list.findIndex((w) => w.id === currentId)
  const t = target.trim().toLowerCase()
  if (list.length === 0) {
    return undefined
  }
  return t === 'next'
    ? list[(index + 1) % list.length]
    : t === 'previous'
      ? list[(index - 1 + list.length) % list.length]
      : /^\d+$/.test(t)
        ? list[Number(t) - 1]
        : list.find((w) => w.name.toLowerCase() === t)
}
