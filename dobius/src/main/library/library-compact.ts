// The short form a work conversation keeps once it is old or space is short:
// its title, the first ask, the final answer, the decisions and the commit or
// PR refs. Built from the stored (already scrubbed) chunks and scrubbed again.
import type { DocClass } from './library-classify'
import { REF_PATTERN } from './library-classify'
import { scrubForIndex } from './library-secrets'
import type { LibraryStore } from './library-store'

export const COMPACT_MAX_CHARS = 4000
export const COMPACT_AFTER_MS = 90 * 24 * 60 * 60 * 1000

const SPEAKER_SPLIT = /\n\n(?=(?:User|Carson|Claude|Codex|ADAM): )/
const DECISION =
  /\b(?:decided|decision|approved|plan is|agreed|we'll use|we will use|don't|do not|never|always|rule)\b/i

function cut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** The speaker turns of a transcript, in order, from its stored chunks. */
export function turnsOf(chunks: string[]): string[] {
  return chunks.flatMap((chunk) => chunk.split(SPEAKER_SPLIT)).map((turn) => turn.trim())
}

const isAsk = (turn: string): boolean => /^(?:User|Carson):/.test(turn)

export function compactText(title: string, chunks: string[]): string {
  const turns = turnsOf(chunks)
  const ask = turns.find(isAsk) ?? ''
  const answer = turns.findLast((turn) => !isAsk(turn) && /^(?:Claude|Codex|ADAM):/.test(turn)) ?? ''
  const decisions: string[] = []
  const refs = new Set<string>()
  for (const turn of turns) {
    for (const line of turn.split('\n')) {
      if (DECISION.test(line) && line.trim().length > 8) {
        const kept = cut(line, 200)
        if (!decisions.includes(kept)) {
          decisions.push(kept)
        }
      }
    }
    for (const match of turn.matchAll(new RegExp(REF_PATTERN.source, 'gi'))) {
      refs.add(cut(match[0], 80))
    }
  }
  const parts = [`Compacted conversation: ${cut(title, 160)}`]
  if (ask) {
    parts.push(`First ask. ${cut(ask, 1000)}`)
  }
  if (answer) {
    parts.push(`Final answer. ${cut(answer, 1400)}`)
  }
  let text = parts.join('\n\n')
  if (refs.size > 0) {
    text += `\n\nRefs: ${[...refs].slice(0, 12).join('; ')}`
  }
  if (decisions.length > 0) {
    text += '\n\nDecisions and rules:'
    for (const line of decisions) {
      if (text.length + line.length + 3 > COMPACT_MAX_CHARS) {
        break
      }
      text += `\n- ${line}`
    }
  }
  const capped = text.slice(0, COMPACT_MAX_CHARS)
  // Why again: the parts are cut and rejoined, so a label can meet a value.
  return scrubForIndex(capped) ?? `Compacted conversation: ${cut(title, 160)}`
}

/** Rewrite a stored work conversation as its compact form; it stays searchable. */
export function compactStoredDoc(store: LibraryStore, docId: number): void {
  const doc = store.db.prepare('SELECT title FROM docs WHERE id = ?').get(docId) as { title: string } | undefined
  if (!doc) {
    return
  }
  const chunks = (
    store.db.prepare('SELECT text FROM chunks WHERE doc_id = ? ORDER BY id').all(docId) as { text: string }[]
  ).map((row) => row.text)
  store.replaceWithCompact(docId, doc.title, compactText(doc.title, chunks))
}

export type ShrinkStep = { id: number; action: 'compact' | 'evict' }

/**
 * The next thing to give up when over the cap: chats go first; then every
 * work conversation is compacted (open before done) before any is dropped;
 * then compacted open work, compacted done work, and reference notes last.
 * Oldest first within each step.
 */
export function nextShrinkStep(store: LibraryStore): ShrinkStep | null {
  const row = store.db
    .prepare(
      `SELECT id, kind, compacted FROM docs WHERE evicted = 0
       ORDER BY CASE
         WHEN kind = 'chat' THEN 0
         WHEN kind = 'work-open' AND compacted = 0 THEN 1
         WHEN kind = 'work-done' AND compacted = 0 THEN 2
         WHEN kind = 'work-open' THEN 3
         WHEN kind = 'work-done' THEN 4
         ELSE 5 END, mtime_ms ASC
       LIMIT 1`
    )
    .get() as { id: number; kind: DocClass; compacted: number } | undefined
  if (!row) {
    return null
  }
  const compact = row.kind.startsWith('work-') && row.compacted === 0
  return { id: row.id, action: compact ? 'compact' : 'evict' }
}

/** Work conversations last changed before the cutoff that still hold their full text. */
export function agedWorkDocs(store: LibraryStore, cutoffMs: number): number[] {
  return (
    store.db
      .prepare(
        `SELECT id FROM docs WHERE evicted = 0 AND compacted = 0 AND kind IN ('work-done', 'work-open')
         AND mtime_ms >= 0 AND mtime_ms < ?`
      )
      .all(Math.round(cutoffMs)) as { id: number }[]
  ).map((row) => row.id)
}
