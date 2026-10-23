import type { ActiveAgentNotesSendStatus } from '@/lib/active-agent-note-send-result'

// Durable facts per repo (plus a "global" scope) that reach an agent only when
// the user pushes them, framed as background context.

export const MEMORY_CATEGORIES = [
  'architecture',
  'structure',
  'commands',
  'conventions',
  'gotchas',
  'context'
] as const
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

export const MEMORY_FACT_MAX = 220
export const MEMORY_TITLE_MAX = 80
export const MEMORY_GLOBAL_SCOPE = 'global'
// ponytail: one fixed path both for scan and refresh answers; the agent writes it, the studio reads it.
export const MEMORY_PROPOSALS_FILE = '.dobius/memory-proposals.json'
// ponytail: cap keeps a pushed brief a sane paste; the rest is summarized as a count.
export const MEMORY_BRIEF_MAX_CHARS = 6000

export type MemoryEntry = {
  id: string
  category: MemoryCategory
  title: string
  fact: string
  active: boolean
}
export type MemoryProposal = Omit<MemoryEntry, 'id' | 'active'>
export type MemoryScanEffort = 'quick' | 'balanced' | 'thorough'

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function clean(text: unknown, max: number): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function toCategory(v: unknown): MemoryCategory {
  const lower = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (MEMORY_CATEGORIES as readonly string[]).includes(lower)
    ? (lower as MemoryCategory)
    : 'context'
}

export function sanitizeProposal(raw: unknown): MemoryProposal | null {
  if (!isObj(raw)) {
    return null
  }
  const title = clean(raw.title, MEMORY_TITLE_MAX)
  const fact = clean(raw.fact, MEMORY_FACT_MAX)
  return title && fact ? { category: toCategory(raw.category), title, fact } : null
}

export function sanitizeEntries(raw: unknown): MemoryEntry[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item) => {
    // Unlike a proposal, a saved entry may have an empty fact while the user is still writing it.
    if (!isObj(item) || typeof item.id !== 'string') {
      return []
    }
    const title = clean(item.title, MEMORY_TITLE_MAX)
    if (!title) {
      return []
    }
    return [
      {
        id: item.id,
        category: toCategory(item.category),
        title,
        fact: clean(item.fact, MEMORY_FACT_MAX),
        active: item.active !== false
      }
    ]
  })
}

export function sanitizeMemoryByScope(raw: unknown): Record<string, MemoryEntry[]> {
  if (!isObj(raw)) {
    return {}
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, sanitizeEntries(v)]))
}

function key(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The existing entry that says the same thing (same fact, ignoring case and punctuation). */
export function findDuplicate(
  entries: readonly MemoryEntry[],
  proposal: Pick<MemoryProposal, 'fact'>
): MemoryEntry | null {
  const k = key(proposal.fact)
  return entries.find((e) => key(e.fact) === k) ?? null
}

/** Entry a refresh answer replaces: same title, ignoring case and punctuation. */
export function findByTitle(entries: readonly MemoryEntry[], title: string): MemoryEntry | null {
  const k = key(title)
  return entries.find((e) => key(e.title) === k) ?? null
}

/** Reads the agent-written proposals file: `{ "proposals": [...] }` or a bare array. */
export function parseProposals(text: string): MemoryProposal[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Agents sometimes wrap JSON in prose or a code fence; take the outermost object/array.
    const match = /[[{][\s\S]*[\]}]/.exec(text)
    if (!match) {
      return null
    }
    try {
      raw = JSON.parse(match[0])
    } catch {
      return null
    }
  }
  const list = Array.isArray(raw) ? raw : isObj(raw) ? raw.proposals : null
  if (!Array.isArray(list)) {
    return null
  }
  return list.flatMap((p) => {
    const ok = sanitizeProposal(p)
    return ok ? [ok] : []
  })
}

const SCAN_DEPTH: Record<MemoryScanEffort, { min: number; read: string }> = {
  quick: { min: 6, read: 'the file tree, README and package/build manifests' },
  balanced: {
    min: 8,
    read: 'the file tree, README, manifests, entry points and config files'
  },
  thorough: {
    min: 12,
    read: 'the file tree, README, manifests, entry points, config, tests and key modules'
  }
}

const FORMAT = `Write ONLY this JSON to ${MEMORY_PROPOSALS_FILE} (create the folder if needed, overwrite the file): {"proposals":[{"category":"<one of ${MEMORY_CATEGORIES.join(', ')}>","title":"<short title>","fact":"<one or two sentences, at most ${MEMORY_FACT_MAX} characters, commands verbatim>"}]}. Do not change any other file.`

export function buildScanPrompt(effort: MemoryScanEffort): string {
  const { min, read } = SCAN_DEPTH[effort]
  return `Read this repo (read-only): ${read}. Propose at least ${min} durable facts a new agent needs before working here. ${FORMAT} Reply "done" when the file is written.`
}

export function buildRefreshPrompt(title: string): string {
  return `Answer this question from the repo as it is now (read-only): "${title}". ${FORMAT} Use exactly one proposal whose title is "${title}". Reply "done" when the file is written.`
}

/** Active entries framed as background context, with a one-word acknowledgement ask. */
export function buildMemoryBrief(entries: readonly MemoryEntry[]): string {
  const active = entries.filter((e) => e.active)
  if (active.length === 0) {
    return ''
  }
  const head =
    'Background context for this repo (not a task, do not act on it). Reply with one word: "noted".'
  const lines: string[] = []
  let used = head.length
  for (const e of active) {
    const line = `- [${e.category}] ${e.title}: ${e.fact}`
    if (used + line.length + 1 > MEMORY_BRIEF_MAX_CHARS) {
      break
    }
    lines.push(line)
    used += line.length + 1
  }
  const more = active.length - lines.length
  return [head, ...lines, ...(more > 0 ? [`(${more} more entries not shown)`] : [])].join('\n')
}

export type MemoryPushOutcome = 'sent' | 'busy' | 'shell' | 'failed'

/** Buckets a notes-send status into the memory card's sent / busy / shell counts. */
export function classifyPushStatus(status: ActiveAgentNotesSendStatus): MemoryPushOutcome {
  switch (status) {
    case 'sent':
      return 'sent'
    case 'permission':
    case 'not-ready':
    case 'status-unavailable':
      return 'busy'
    case 'no-agent':
      return 'shell'
    case 'empty':
    case 'no-active-terminal':
    case 'not-writable':
    case 'partial-submit-failed':
      return 'failed'
  }
}
