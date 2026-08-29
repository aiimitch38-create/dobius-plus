import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Fixed categories, copied from Mark LI.
 *
 * Why fixed: a model given a free-form category invents `misc` and `temp`, and
 * memory becomes a junk drawer nobody can reason about. Six buckets also make
 * eviction decidable — see EVICTION_ORDER.
 */
export const MEMORY_CATEGORIES = [
  'identity',
  'preferences',
  'projects',
  'relationships',
  'wishes',
  'notes'
] as const

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

export type MemoryEntry = {
  category: MemoryCategory
  key: string
  value: string
  updatedAt: number
}

export const MAX_VALUE_CHARS = 380
/**
 * Keys are capped for the same reason values are: `entryCost` counts both, so an
 * uncapped key lets ONE entry exceed MAX_TOTAL_CHARS on its own. Eviction cannot
 * clear it (there is nothing else to drop), so the store stays over cap forever
 * and `format()` returns a block big enough to push the whole machine state out
 * of the agent payload. The model chooses this string, so it is reachable.
 */
export const MAX_KEY_CHARS = 80
export const MAX_TOTAL_CHARS = 2_200

/**
 * What gets dropped first when the store is full.
 *
 * `notes` is the catch-all so it is the cheapest thing to lose; `identity` is
 * who the user IS and is the last thing to go. Within a category, oldest first.
 */
const EVICTION_ORDER: MemoryCategory[] = [
  'notes',
  'wishes',
  'projects',
  'relationships',
  'preferences',
  'identity'
]

export type RememberResult = { ok: true } | { ok: false; error: string }

function isCategory(value: string): value is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(value)
}

/** Trimmed and lowercased so `Wife` and `wife ` cannot become two facts. */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, ' ')
}

function entryCost(entry: MemoryEntry): number {
  return entry.key.length + entry.value.length
}

/**
 * Adam's own memory: what he chose to keep, as opposed to the conversation
 * summaries ElevenLabs hands back.
 *
 * Persisted as plain JSON in userData so Carson can read or delete it by hand —
 * a memory the user cannot inspect is one they cannot correct.
 */
export class AdamMemory {
  private entries: MemoryEntry[] = []

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now
  ) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      if (!Array.isArray(parsed)) {
        return
      }
      this.entries = parsed.filter(
        (entry): entry is MemoryEntry =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as MemoryEntry).key === 'string' &&
          typeof (entry as MemoryEntry).value === 'string' &&
          isCategory(String((entry as MemoryEntry).category))
      )
    } catch {
      // A corrupt file must not stop the app starting. Starting empty loses
      // memory; throwing here would lose the whole voice feature.
      this.entries = []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8')
  }

  /**
   * Drops entries until the store fits, cheapest category first and oldest
   * within it. Runs after the write so a new fact is never rejected for size —
   * it displaces an older one instead.
   *
   * `protectedKey` is the entry just written, and it is excluded from selection.
   * Without that, an insert whose category ranks first for eviction can choose
   * ITSELF as the victim: `remember` still returns ok, the IPC still answers
   * "Saved. I'll remember that.", and nothing was stored. A memory that lies
   * about what it kept is worse than one that refuses.
   */
  private evict(protectedKey: string): void {
    const total = (): number => this.entries.reduce((sum, entry) => sum + entryCost(entry), 0)
    while (total() > MAX_TOTAL_CHARS) {
      let victim = -1
      for (let index = 0; index < this.entries.length; index += 1) {
        const candidate = this.entries[index]
        if (candidate.key === protectedKey) {
          continue
        }
        if (victim === -1) {
          victim = index
          continue
        }
        const current = this.entries[victim]
        const candidateRank = EVICTION_ORDER.indexOf(candidate.category)
        const currentRank = EVICTION_ORDER.indexOf(current.category)
        if (
          candidateRank < currentRank ||
          (candidateRank === currentRank && candidate.updatedAt < current.updatedAt)
        ) {
          victim = index
        }
      }
      if (victim === -1) {
        // Only the protected entry is left. It costs at most MAX_KEY_CHARS +
        // MAX_VALUE_CHARS, far under the total cap, so this terminates.
        return
      }
      this.entries.splice(victim, 1)
    }
  }

  remember(category: string, key: string, value: string): RememberResult {
    const cleanCategory = String(category ?? '').trim().toLowerCase()
    if (!isCategory(cleanCategory)) {
      return {
        ok: false,
        error: `"${category}" is not a memory category. Use one of: ${MEMORY_CATEGORIES.join(', ')}.`
      }
    }
    const cleanKey = normalizeKey(String(key ?? ''))
    if (!cleanKey) {
      return { ok: false, error: 'That memory needs a key.' }
    }
    if (cleanKey.length > MAX_KEY_CHARS) {
      return {
        ok: false,
        error: `That key is ${cleanKey.length} characters; keep it under ${MAX_KEY_CHARS}.`
      }
    }
    const cleanValue = String(value ?? '').trim()
    if (!cleanValue) {
      return { ok: false, error: 'That memory needs a value.' }
    }
    if (cleanValue.length > MAX_VALUE_CHARS) {
      // Refused rather than truncated: half a fact read back as whole is worse
      // than no fact, and the model can shorten it and retry.
      return {
        ok: false,
        error: `That is ${cleanValue.length} characters; keep it under ${MAX_VALUE_CHARS}.`
      }
    }
    const existing = this.entries.findIndex((entry) => entry.key === cleanKey)
    const entry: MemoryEntry = {
      category: cleanCategory,
      key: cleanKey,
      value: cleanValue,
      updatedAt: this.now()
    }
    if (existing === -1) {
      this.entries.push(entry)
    } else {
      this.entries[existing] = entry
    }
    this.evict(cleanKey)
    this.save()
    return { ok: true }
  }

  forget(key: string): boolean {
    const cleanKey = normalizeKey(String(key ?? ''))
    const before = this.entries.length
    this.entries = this.entries.filter((entry) => entry.key !== cleanKey)
    if (this.entries.length === before) {
      return false
    }
    this.save()
    return true
  }

  list(): MemoryEntry[] {
    return [...this.entries]
  }

  /** The block injected into the agent's context. Empty when nothing is stored. */
  format(): string {
    if (this.entries.length === 0) {
      return ''
    }
    const lines = ['## What I remember about the user']
    for (const category of MEMORY_CATEGORIES) {
      const inCategory = this.entries.filter((entry) => entry.category === category)
      if (inCategory.length === 0) {
        continue
      }
      lines.push(`${category}:`)
      for (const entry of inCategory) {
        lines.push(`  ${entry.key}: ${entry.value}`)
      }
    }
    return lines.join('\n')
  }
}
