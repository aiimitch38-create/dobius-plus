/* What the kitchen manager tells ADAM and Carson: finished, blocked, or needs
 * Carson. Same rule as the conductor (shared/conductor-speech.ts): anything a
 * model may hear is a fixed template plus the card's own id. The card title
 * only reaches Carson's thread row, which no model reads. Nothing here ever
 * holds a word from a cook's terminal. */

import {
  conductorSpeech,
  KITCHEN_COOK_NAME,
  type ConductorEvent
} from '../../shared/conductor-speech'
import { clip, CONDUCTOR_NOTICE_MAX_CHARS, safeLabel } from '../jarvis/adam-conductor-text'
import type { KitchenEvent, KitchenNotice } from './kitchen'

const CONTEXT_MAX = 20

export type KitchenReport = {
  /** The existing conductor event the live call says it as. */
  event: Extract<ConductorEvent, 'done' | 'needs-you'>
  name: typeof KITCHEN_COOK_NAME
  /** Template only ("A kitchen cook finished."): what the live voice says. */
  spoken: string
  /** Template plus the card id: what ADAM reads on his next turn. */
  context: string
  /** For Carson's thread only (shows the card title); never sent to a model. */
  display: string
  at: number
}

const CONTEXT: Record<KitchenEvent, string> = {
  finished: 'A kitchen cook finished. Its card is in Review for Carson',
  blocked: 'A kitchen cook was stopped after one restart. Its card is in Blocked and needs Carson',
  'needs-carson': 'A kitchen cook is waiting for Carson to approve a command in its console'
}

const DISPLAY: Record<KitchenEvent, string> = {
  finished: 'finished. Its card is in Review.',
  blocked: 'was stopped after one restart. Its card is in Blocked.',
  'needs-carson': 'is waiting for you to approve a command in its console.'
}

function safeCardId(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'unknown'
}

export function kitchenReport(notice: KitchenNotice): KitchenReport {
  const event = notice.event === 'finished' ? 'done' : 'needs-you'
  return {
    event,
    name: KITCHEN_COOK_NAME,
    spoken: conductorSpeech([{ event, name: KITCHEN_COOK_NAME }]),
    context: `${CONTEXT[notice.event]} (card ${safeCardId(notice.taskId)}).`,
    display: clip(
      `The kitchen cook on "${safeLabel(notice.title)}" ${DISPLAY[notice.event]}`,
      CONDUCTOR_NOTICE_MAX_CHARS
    ),
    at: notice.at
  }
}

let unseen: string[] = []
let reporter: ((report: KitchenReport) => void) | null = null

/** Set once ADAM's thread exists (jarvis-ipc.ts). */
export function setKitchenReporter(next: ((report: KitchenReport) => void) | null): void {
  reporter = next
}

/** The kitchen's `tellAdam`: kept for ADAM's next turn and shown to Carson. */
export function reportKitchenNotice(notice: KitchenNotice): void {
  const report = kitchenReport(notice)
  unseen = [...unseen, report.context].slice(-CONTEXT_MAX)
  reporter?.(report)
}

/** The kitchen updates since ADAM's last turn, once (like the conductor's takeContext). */
export function takeKitchenContext(): string[] {
  const lines = unseen
  unseen = []
  return lines
}
