import { randomUUID } from 'node:crypto'
import type { AdamTurnEvent, AdamTurnSource, JarvisAskResult } from '../../shared/speech-types'

export const ADAM_TURN_CHANNEL = 'jarvis:adam-turn'
export const ADAM_BUSY_TEXT =
  'ADAM is busy with another message. Wait for his reply, then try again.'

export type AdamAskOptions = {
  source: AdamTurnSource
  /** What the thread should show as Carson's words when `text` carries extra context. */
  said?: string
  /** The Board thread the turn started from, so the reply lands there and nowhere else. */
  threadId?: string | null
}

type AdamBrain = { ask: (text: string) => Promise<JarvisAskResult> }

/**
 * The one way in to ADAM. Voice, the Board thread and any later voice engine
 * all call `ask`, so they share one Hermes session (the brain keeps a single
 * saved session id) and one conversation: each accepted turn is announced
 * twice, once with the words asked and once with the reply, for the thread.
 */
export class AdamConversation {
  private inFlight = false

  constructor(
    private readonly brain: AdamBrain,
    private readonly announce: (event: AdamTurnEvent) => void
  ) {}

  async ask(
    text: string,
    options: AdamAskOptions
  ): Promise<JarvisAskResult> {
    // Why refuse and not queue: Hermes runs one turn per session, and a queued
    // voice turn would answer minutes late. The caller shows this and Carson resends.
    if (this.inFlight) {
      return { kind: 'error', text: ADAM_BUSY_TEXT }
    }
    this.inFlight = true
    const turn = {
      turnId: randomUUID(),
      source: options.source,
      threadId: options.threadId ?? null
    }
    try {
      this.announce({ ...turn, phase: 'asked', text: options.said ?? text, at: Date.now() })
      let result: JarvisAskResult
      try {
        result = await this.brain.ask(text)
      } catch {
        result = { kind: 'error', text: 'ADAM is unreachable' }
      }
      this.announce({ ...turn, phase: 'answered', result, at: Date.now() })
      return result
    } finally {
      this.inFlight = false
    }
  }
}
