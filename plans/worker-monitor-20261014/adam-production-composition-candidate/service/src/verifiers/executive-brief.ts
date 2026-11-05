import { databaseIntegrity, type AdamDatabase } from '../db/database.js'
import type { ExecutiveBrief } from '../intelligence/executive-brief.js'

export type BriefVerification = {
  passed: boolean
  checks: Record<string, boolean>
  failures: string[]
}

export function verifyExecutiveBrief(
  db: AdamDatabase,
  brief: ExecutiveBrief,
  awareness: { worktrees: number; sessions: number; newEvents: number; active: number; blocked: number },
  now = new Date()
): BriefVerification {
  const generatedMs = Date.parse(brief.generatedAt)
  const checks: Record<string, boolean> = {
    databaseIntegrity: databaseIntegrity(db) === 'ok',
    generatedAtValid: Number.isFinite(generatedMs),
    generatedRecently: Number.isFinite(generatedMs) && Math.abs(now.getTime() - generatedMs) <= 60_000,
    awarenessObserved: awareness.worktrees > 0 && awareness.sessions >= 0,
    receiptSetComplete: ['sessions', 'commitments', 'projects'].every((kind) => brief.receipts.some((receipt) => receipt.kind === kind)),
    attentionBounded: brief.attention.length <= 3,
    attentionUnique: new Set(brief.attention.map((item) => item.id)).size === brief.attention.length,
    attentionTraceable: true
  }

  for (const item of brief.attention) {
    if (item.id.startsWith('commitment:')) {
      const id = item.id.slice('commitment:'.length)
      const row = db.prepare('SELECT expected_outcome, confidence, state FROM commitments WHERE id = ?').get(id) as
        | { expected_outcome: string; confidence: number; state: string }
        | undefined
      if (!row) {
        checks.attentionTraceable = false
        continue
      }
      const outcome = JSON.parse(row.expected_outcome) as { text?: string }
      if (outcome.text !== item.summary || (row.state !== 'open' && row.confidence < 0.8)) {
        checks.attentionTraceable = false
      }
      continue
    }
    if (item.id.startsWith('blocked:')) {
      const id = item.id.slice('blocked:'.length)
      const row = db.prepare("SELECT id FROM sessions WHERE id = ? AND state = 'blocked'").get(id)
      if (!row) checks.attentionTraceable = false
      continue
    }
    checks.attentionTraceable = false
  }

  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  return { passed: failures.length === 0, checks, failures }
}
