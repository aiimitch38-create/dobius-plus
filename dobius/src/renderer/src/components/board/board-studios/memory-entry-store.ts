import { moveEntryBetweenScopes, sanitizeMemoryByScope, type MemoryEntry } from './memory-entries'

// ponytail: same shape as the preset store: read/written straight through
// persisted UI; no slice, since only the Memory studio and memory cards read it.

async function readAll(): Promise<Record<string, MemoryEntry[]>> {
  return sanitizeMemoryByScope((await window.api.ui.get()).boardMemoryByRepo)
}

export async function listMemoryEntries(scope: string): Promise<MemoryEntry[]> {
  return (await readAll())[scope] ?? []
}

export async function saveMemoryEntries(
  scope: string,
  entries: MemoryEntry[]
): Promise<MemoryEntry[]> {
  const all = await readAll()
  all[scope] = entries
  await window.api.ui.set({ boardMemoryByRepo: all })
  return entries
}

/** Moves one fact to another scope in a single read-modify-write; returns both scopes' lists. */
export async function moveMemoryEntry(
  from: string,
  to: string,
  id: string
): Promise<{ from: MemoryEntry[]; to: MemoryEntry[] }> {
  const next = moveEntryBetweenScopes(await readAll(), from, to, id)
  await window.api.ui.set({ boardMemoryByRepo: next })
  return { from: next[from] ?? [], to: next[to] ?? [] }
}
