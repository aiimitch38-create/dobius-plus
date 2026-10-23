import { sanitizeMemoryByScope, type MemoryEntry } from './memory-entries'

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
