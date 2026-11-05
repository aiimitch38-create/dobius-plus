import type { AdamDatabase } from '../db/database.js'
import { scoreAttention, type ScoredAttentionSignal } from './attention.js'

export type ExecutiveBrief = {
  generatedAt: string
  headline: string
  attention: ScoredAttentionSignal[]
  routineResolved: number
  draftsPrepared: number
  projectRisks: number
  receipts: Array<{ kind: string; source: string }>
}

export function buildExecutiveBrief(db: AdamDatabase, now = new Date()): ExecutiveBrief {
  const blocked = db.prepare(`
    SELECT id, project_id, prompt, last_seen_at FROM sessions WHERE state = 'blocked' ORDER BY last_seen_at DESC LIMIT 10
  `).all() as Array<{ id: string; project_id: string | null; prompt: string | null; last_seen_at: string }>
  const candidates = db.prepare(`
    SELECT id, expected_outcome, confidence, deadline, evidence_event_id FROM commitments
    WHERE state = 'open' OR (state = 'candidate' AND confidence >= 0.8)
    ORDER BY COALESCE(deadline, '9999-12-31'), updated_at DESC LIMIT 20
  `).all() as Array<{
    id: string
    expected_outcome: string
    confidence: number
    deadline: string | null
    evidence_event_id: string | null
  }>

  const attention: ScoredAttentionSignal[] = []
  for (const item of blocked) {
    attention.push(
      scoreAttention({
        id: `blocked:${item.id}`,
        summary: `${item.project_id ?? 'Project'} is blocked: ${item.prompt ?? 'reason not captured'}`,
        urgency: 0.8,
        importance: 0.8,
        confidence: 1,
        reversibility: 0.5,
        userInterruptibility: 0.5
      })
    )
  }
  for (const commitment of candidates) {
    const outcome = JSON.parse(commitment.expected_outcome) as { text: string }
    const deadlineMs = commitment.deadline ? Date.parse(commitment.deadline) : Number.POSITIVE_INFINITY
    const hours = (deadlineMs - now.getTime()) / 3_600_000
    attention.push(
      scoreAttention({
        id: `commitment:${commitment.id}`,
        summary: outcome.text,
        urgency: hours <= 24 ? 0.9 : hours <= 72 ? 0.65 : 0.35,
        importance: 0.7,
        confidence: commitment.confidence,
        reversibility: 0.6,
        userInterruptibility: 0.5
      })
    )
  }
  attention.sort((left, right) => right.score - left.score)
  const top = attention.slice(0, 3)
  return {
    generatedAt: now.toISOString(),
    headline: `${top.length} item${top.length === 1 ? '' : 's'} need your attention.`,
    attention: top,
    routineResolved: 0,
    draftsPrepared: 0,
    projectRisks: blocked.length,
    receipts: [
      { kind: 'sessions', source: 'adam.sqlite:sessions' },
      { kind: 'commitments', source: 'adam.sqlite:commitments' },
      { kind: 'projects', source: 'adam.sqlite:project_ledger' }
    ]
  }
}
