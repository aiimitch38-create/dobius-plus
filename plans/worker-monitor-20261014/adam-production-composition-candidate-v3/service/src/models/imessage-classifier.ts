import { randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'

export type IMessageModelDecision = {
  id: string
  lane: 'fast' | 'balanced' | 'execution'
  harness: 'claude' | 'supervisor'
  model: 'haiku' | 'sonnet' | 'opus'
  workerPreference?: 'codex' | 'claude'
  reason: string
  features: string[]
}

const EXECUTION = /\b(build|implement|fix|debug|deploy|create|send|email|calendar|monitor|launch|spin up|clone|install|connect|wire|run|test|edit|change|update|research|audit|review|investigate|look into|go through)\b/i
const DELEGATION = /\b(i need your help|help me with|can you go|go on|go to|open|look at|check|you(?:'|’)ll see|you will see|take care of|handle this)\b/i
const CODING = /\b(code|coding|repo|repository|git|github|terminal|cli|script|typescript|javascript|python|bug|test|build|implement|fix|debug|deploy|worktree|agent)\b/i
const REASONING = /\b(why|how should|how can|explain|compare|contrast|plan|map out|analyze|architecture|recommend|what do you think|pros and cons|strategy)\b/i
const HIGH_STAKES = /\b(production|deploy|money|payment|legal|security|delete|email|calendar|client|customer|external)\b/i

export function classifyIMessageModel(text: string, frameMode?: string): Omit<IMessageModelDecision, 'id'> {
  const normalized = text.trim()
  const features: string[] = []
  if (normalized.length >= 180) features.push('long_message')
  if (EXECUTION.test(normalized)) features.push('execution_verb')
  if (DELEGATION.test(normalized)) features.push('delegation_phrase')
  if (CODING.test(normalized)) features.push('coding_context')
  if (REASONING.test(normalized)) features.push('reasoning_request')
  if (HIGH_STAKES.test(normalized)) features.push('high_stakes')

  if (frameMode === 'waiting') return { lane: 'fast', harness: 'claude', model: 'haiku', reason: 'conversation is explicitly waiting', features: [...features, 'frame_waiting'] }
  if (frameMode === 'brainstorming' || frameMode === 'planning' || frameMode === 'listening') {
    return { lane: 'balanced', harness: 'claude', model: 'sonnet', reason: `conversation frame is ${frameMode}; execution is suppressed`, features: [...features, `frame_${frameMode}`] }
  }

  if (features.includes('execution_verb') || features.includes('delegation_phrase') || features.includes('high_stakes')) {
    const workerPreference = features.includes('coding_context') ? 'codex' as const : 'claude' as const
    return {
      lane: 'execution', harness: 'supervisor', model: 'opus', workerPreference,
      reason: `tool-capable execution; prefer ${workerPreference} worker`, features
    }
  }
  if (features.includes('reasoning_request') || features.includes('long_message')) {
    return { lane: 'balanced', harness: 'claude', model: 'sonnet', reason: 'reasoning without an explicit side effect', features }
  }
  return { lane: 'fast', harness: 'claude', model: 'haiku', reason: 'ordinary low-risk conversation', features }
}

export class IMessageModelClassifier {
  constructor(private readonly db: AdamDatabase) {}

  decide(messageId: string, text: string, frameMode?: string): IMessageModelDecision {
    const existing = this.db.prepare('SELECT * FROM imessage_model_decisions WHERE inbound_message_id=?').get(messageId) as Record<string, unknown> | undefined
    if (existing) return {
      id: String(existing.id), lane: existing.lane as IMessageModelDecision['lane'],
      harness: existing.harness as IMessageModelDecision['harness'], model: existing.model as IMessageModelDecision['model'],
      ...(existing.worker_preference ? { workerPreference: existing.worker_preference as 'codex' | 'claude' } : {}),
      reason: String(existing.reason), features: JSON.parse(String(existing.features)) as string[]
    }
    const decision = classifyIMessageModel(text, frameMode)
    const id = randomUUID()
    this.db.prepare(`INSERT INTO imessage_model_decisions
      (id,inbound_message_id,lane,harness,model,worker_preference,reason,features,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
        id, messageId, decision.lane, decision.harness, decision.model,
        decision.workerPreference ?? null, decision.reason, JSON.stringify(decision.features), new Date().toISOString()
      )
    return { id, ...decision }
  }
}
