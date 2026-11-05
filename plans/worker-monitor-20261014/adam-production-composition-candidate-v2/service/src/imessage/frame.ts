import { randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'

export type ConversationMode = 'listening' | 'brainstorming' | 'planning' | 'executing' | 'waiting'
export type ConversationFrame = {
  mode: ConversationMode
  objective?: string
  entities: string[]
  constraints: string[]
  corrections: string[]
  normalizedText: string
  promptContract: string
}

const uniq = (items: string[]): string[] => [...new Set(items)]
const parse = (value: unknown): string[] => JSON.parse(String(value ?? '[]')) as string[]

export function normalizeCarsonText(text: string): string {
  return text
    .replace(/\ba sauna\b/gi, 'Asana')
    .replace(/\bsm ids?\b/gi, 'SMID')
    .replace(/\bpocket small\b/gi, 'Pocket Cologne')
    .replace(/\bpc if\b/gi, 'PCIF')
    .replace(/\s+/g, ' ')
    .trim()
}

function entities(text: string): string[] {
  return [
    ...(/pocket cologne/i.test(text) ? ['Pocket Cologne'] : []),
    ...(/\b(status digital|smid)\b/i.test(text) ? ['Status Digital (SMID)'] : []),
    ...(/\bpcif\b/i.test(text) ? ['PCIF'] : []),
    ...(/\basana\b/i.test(text) ? ['Asana'] : [])
  ]
}

export class IMessageConversationFrameManager {
  constructor(private readonly db: AdamDatabase) {}

  update(senderId: string, messageId: string, rawText: string): ConversationFrame {
    const prior = this.db.prepare('SELECT * FROM imessage_conversation_frames WHERE sender_id=?').get(senderId) as Record<string, unknown> | undefined
    const normalizedText = normalizeCarsonText(rawText)
    const lower = normalizedText.toLowerCase()
    const expired = prior?.updated_at ? Date.now() - Date.parse(String(prior.updated_at)) > 30 * 60_000 : false
    const correction = /^(no\b|no[, ]+no\b|i mean\b|not that\b|actually\b)/i.test(normalizedText)
    const planningOnly = /\b(list first|creating a list|create a list|need a list|just (?:need|building|making) (?:a )?list|map through|mapping through|map (?:this )?out|then (?:we(?:'|’)ll|we will) implement|don['’]?t implement|do not implement|not implementing|still just building the list)\b/i.test(normalizedText)
    const waiting = /\b(just wait|wait for now|hold off|pause|don['’]?t even monitor|do not monitor|stay quiet)\b/i.test(normalizedText)
    const explicitExecute = /\b(let['’]?s implement|go ahead and implement|start implementing|execute (?:it|this|the plan)|build it now|start building now)\b/i.test(normalizedText)
    const newTopic = /\b(new topic|different topic|separate question|something else|switch gears)\b/i.test(normalizedText)
    const delegatedTask = /\b(can you|could you|please|i need you to|i want you to)\b.*\b(check|research|inspect|build|implement|fix|send|open|monitor|review|create)\b/i.test(normalizedText)
    let mode = expired || newTopic ? 'listening' : ((prior?.mode as ConversationMode | undefined) ?? 'listening')
    if (waiting) mode = 'waiting'
    else if (planningOnly) mode = 'brainstorming'
    else if (explicitExecute || delegatedTask) mode = 'executing'
    else if (mode === 'brainstorming') mode = 'brainstorming'

    const retainPrior = Boolean(prior && !expired && !newTopic)
    const priorConstraints = retainPrior ? parse(prior!.constraints) : []
    const constraints = uniq([
      ...priorConstraints,
      ...(planningOnly ? ['capture_only', 'do_not_execute_yet'] : []),
      ...(/\bseparate from (?:a )?repo|not (?:a )?repo|no repo/i.test(normalizedText) ? ['not_repository_automation'] : []),
      ...(/\bpersonal automation|personal visibility|people know (?:that )?i['’]?m working|team.*see.*work/i.test(normalizedText) ? ['personal_team_visibility'] : []),
      ...(/\basana\b/i.test(normalizedText) ? ['asana_only'] : []),
      ...(waiting ? ['no_monitoring', 'no_proactive_updates'] : [])
    ]).filter((item) => !(explicitExecute && item === 'do_not_execute_yet'))
    const allEntities = uniq([...(retainPrior ? parse(prior!.entities) : []), ...entities(normalizedText)])
    const corrections = uniq([...(retainPrior ? parse(prior!.corrections) : []), ...(correction ? [normalizedText] : [])]).slice(-10)
    const objective = /automation/i.test(normalizedText)
      ? 'Build a list of personal Asana visibility automations for the named projects'
      : (retainPrior && prior?.objective ? String(prior.objective) : undefined)
    const promptContract = [
      `Conversation mode: ${mode}.`,
      objective ? `Current objective: ${objective}.` : '',
      allEntities.length ? `Known entities: ${allEntities.join(', ')}.` : '',
      constraints.length ? `Hard constraints: ${constraints.join(', ')}.` : '',
      mode === 'brainstorming' ? 'Carson is still dictating. Capture and organize; do not research, inspect tools, launch work, or implement. Reflect the frame briefly and let him continue.' : '',
      correction ? 'This message corrects the prior interpretation. Explicitly adopt the correction; do not defend or repeat the old interpretation.' : '',
      mode === 'waiting' ? 'Acknowledge once, stop monitoring/proactive work, and remain silent until Carson resumes.' : ''
    ].filter(Boolean).join(' ')
    const frame: ConversationFrame = { mode, ...(objective ? { objective } : {}), entities: allEntities, constraints, corrections, normalizedText, promptContract }
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO imessage_conversation_frames
      (sender_id,mode,objective,entities,constraints,corrections,source_message_id,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(sender_id) DO UPDATE SET
      mode=excluded.mode,objective=excluded.objective,entities=excluded.entities,constraints=excluded.constraints,
      corrections=excluded.corrections,source_message_id=excluded.source_message_id,updated_at=excluded.updated_at`).run(
        senderId, mode, objective ?? null, JSON.stringify(allEntities), JSON.stringify(constraints), JSON.stringify(corrections), messageId, now
      )
    this.db.prepare(`INSERT OR IGNORE INTO imessage_conversation_frame_events
      (id,sender_id,source_message_id,prior_mode,next_mode,normalized_text,frame,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
        randomUUID(), senderId, messageId, prior ? String(prior.mode) : null, mode, normalizedText, JSON.stringify(frame), now
      )
    return frame
  }
}
