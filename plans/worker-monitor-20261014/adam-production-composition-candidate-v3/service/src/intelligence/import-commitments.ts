import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AdamDatabase } from '../db/database.js'

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseDeadline(text: string): string | null {
  const match = text.match(/\bdue\s+(\d{1,2}):(\d{2})(am|pm)(?:\s+tonight)?\s+(\d{4})-(\d{2})-(\d{2})/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3]!.toLowerCase()
  if (meridiem === 'pm' && hour !== 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  const [, , , , year, month, day] = match
  return `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-05:00`
}

export async function importMarkdownCommitments(db: AdamDatabase, path: string): Promise<number> {
  const content = await readFile(path, 'utf8')
  const sourceDigest = digest(content)
  const eventKey = `commitments-md:${sourceDigest}`
  let event = db.prepare('SELECT id FROM events WHERE event_key = ?').get(eventKey) as { id: string } | undefined
  if (!event) {
    const id = randomUUID()
    const at = new Date().toISOString()
    db.prepare(`
      INSERT INTO events (id, event_key, project_id, type, payload, occurred_at, ingested_at)
      VALUES (?, ?, 'adam', 'commitments.snapshot', ?, ?, ?)
    `).run(id, eventKey, JSON.stringify({ path, sourceDigest }), at, at)
    event = { id }
  }
  const openBlock = content.match(/## Open\s*\n([\s\S]*?)(?=\n## Done|$)/)?.[1] ?? ''
  const lines = openBlock.split('\n').filter((line) => /^- \[ \] /.test(line))
  let inserted = 0
  for (const line of lines) {
    const text = line.replace(/^- \[ \] /, '').trim()
    const outcome = text.split(/\s+—\s+/)[0]!.trim()
    const key = digest(`carson\0${outcome}`)
    const existing = db.prepare(`
      SELECT id FROM commitments WHERE json_extract(expected_outcome, '$.fingerprint') = ?
    `).get(key)
    const at = new Date().toISOString()
    if (existing) {
      db.prepare(`
        UPDATE commitments SET deadline = COALESCE(?, deadline), evidence_event_id = ?, confidence = 0.95,
          state = 'open', updated_at = ? WHERE id = ?
      `).run(parseDeadline(text), event.id, at, (existing as { id: string }).id)
      continue
    }
    db.prepare(`
      INSERT INTO commitments (
        id, owner, expected_outcome, deadline, evidence_event_id, confidence, state, created_at, updated_at
      ) VALUES (?, 'carson', ?, ?, ?, 0.95, 'open', ?, ?)
    `).run(
      randomUUID(),
      JSON.stringify({ text: outcome, detail: text, fingerprint: key }),
      parseDeadline(text),
      event.id,
      at,
      at
    )
    inserted++
  }
  return inserted
}

