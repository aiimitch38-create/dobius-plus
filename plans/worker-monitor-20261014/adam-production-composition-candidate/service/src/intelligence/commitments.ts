import { createHash, randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'

const COMMITMENT_PATTERNS = [
  /\bI(?:'ll| will| am going to)\s+([^.!?]{5,220})/gi,
  /\bwe(?:'ll| will| need to)\s+([^.!?]{5,220})/gi,
  /\b(?:promised|committed|due|deadline)\b[:\s-]+([^.!?]{5,220})/gi
]

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function fingerprint(owner: string | null, outcome: string, eventId: string): string {
  return createHash('sha256').update(`${owner ?? ''}\0${outcome}\0${eventId}`).digest('hex')
}

export function extractCommitmentCandidates(db: AdamDatabase, since?: string): number {
  const events = db.prepare(`
    SELECT id, payload, occurred_at FROM events
    WHERE (? IS NULL OR occurred_at >= ?)
    ORDER BY occurred_at
  `).all(since ?? null, since ?? null) as Array<{ id: string; payload: string; occurred_at: string }>
  let inserted = 0
  for (const event of events) {
    const payload = JSON.parse(event.payload) as {
      agent?: { prompt?: string; lastAssistantMessage?: string | null }
    }
    const texts = [payload.agent?.prompt, payload.agent?.lastAssistantMessage].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    for (const text of texts) {
      for (const pattern of COMMITMENT_PATTERNS) {
        pattern.lastIndex = 0
        for (const match of text.matchAll(pattern)) {
          const outcome = normalize(match[1] ?? '')
          if (!outcome) continue
          const owner = /^I(?:'ll| will| am)/i.test(match[0]) ? 'carson_or_speaker' : null
          const key = fingerprint(owner, outcome, event.id)
          const exists = db.prepare(`
            SELECT 1 FROM commitments WHERE json_extract(expected_outcome, '$.fingerprint') = ?
          `).get(key)
          if (exists) continue
          const at = new Date().toISOString()
          db.prepare(`
            INSERT INTO commitments (id, owner, expected_outcome, evidence_event_id, confidence, state, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0.55, 'candidate', ?, ?)
          `).run(randomUUID(), owner, JSON.stringify({ text: outcome, fingerprint: key }), event.id, at, at)
          inserted++
        }
      }
    }
  }
  return inserted
}

