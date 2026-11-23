// One live call's quick-hand turns: tries a quick hand for a spoken request,
// and keeps each answered exchange where ADAM can see it.
import type { AdamThreadRow, LiveDelegateResult } from '../../shared/speech-types'
import { runQuickHand, type QuickHandsDeps } from './live-voice-quick-hands'
import { speakableReply } from './live-voice-spoken'

const LINES_MAX = 8
const LINE_MAX_CHARS = 300
const ROW_MAX_CHARS = 4_000

export type QuickTurnDeps = {
  hands: QuickHandsDeps
  appendThread: (row: AdamThreadRow) => Promise<void>
  log: (source: string, text: string) => void
}

/** What a quick hand did with a request; null means ADAM should take it. */
export type QuickTurn = { outcome: string; result: LiveDelegateResult }

const CANCELLED: LiveDelegateResult = { ok: true, kind: 'cancelled', speak: '' }

export class LiveQuickTurns {
  private lines: string[] = []
  private count = 0

  constructor(private readonly deps: QuickTurnDeps) {}

  /** A new call starts with no earlier quick answers. */
  reset(): void {
    this.lines = []
  }

  /** This call's quick exchanges, for the next request ADAM gets (follow-ups). */
  recentLines(): string[] {
    return [...this.lines]
  }

  /**
   * Null when no quick hand answered and nothing was written, so ADAM may
   * take the request. Once `isCurrent` turns false nothing more is written
   * and the turn is cancelled, never handed to ADAM.
   */
  async tryAnswer(
    request: string,
    callToken: string,
    isCurrent: () => boolean
  ): Promise<QuickTurn | null> {
    try {
      const quick = await runQuickHand(request, this.deps.hands, isCurrent)
      if (quick?.cancelled) {
        return { outcome: 'cancelled', result: CANCELLED }
      }
      if (quick) {
        if (!isCurrent()) {
          return { outcome: 'cancelled', result: CANCELLED }
        }
        const speak = speakableReply(quick.speak)
        this.remember(callToken, request, speak)
        return { outcome: `quick:${quick.name}`, result: { ok: true, kind: 'answer', speak } }
      }
    } catch (error) {
      // Nothing was written (any partial write is spoken instead), so ADAM
      // gets the request as if no quick hand existed.
      this.deps.log('quick-hand', error instanceof Error ? error.message : String(error))
    }
    return isCurrent() ? null : { outcome: 'cancelled', result: CANCELLED }
  }

  /**
   * Why main writes both rows: the window leaves a delegated request and its
   * spoken answer out of its transcript (askAdam normally writes them), so
   * without this a quick exchange would be missing from ADAM's thread.
   */
  private remember(callToken: string, request: string, speak: string): void {
    const id = `live:${callToken}:quick-${++this.count}`
    this.lines = [
      ...this.lines,
      `Carson: ${request}`.slice(0, LINE_MAX_CHARS),
      `ADAM's quick answer: ${speak}`.slice(0, LINE_MAX_CHARS)
    ].slice(-LINES_MAX)
    const rows: AdamThreadRow[] = [
      { id: `${id}:user`, role: 'user', text: request.slice(0, ROW_MAX_CHARS), voice: true },
      { id: `${id}:assistant`, role: 'assistant', text: speak, voice: true }
    ]
    void (async () => {
      for (const row of rows) {
        await this.deps.appendThread(row)
      }
    })().catch((error: unknown) => {
      this.deps.log(
        'quick-hand',
        `thread row not saved: ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }
}
