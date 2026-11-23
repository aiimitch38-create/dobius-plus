// One live call's quick-hand turns: tries a quick hand for a spoken request,
// finishes a "which one?" when Carson answers it, and keeps each answered
// exchange where ADAM can see it.
import type { AdamThreadRow, LiveDelegateResult } from '../../shared/speech-types'
import {
  runQuickHand,
  runQuickHandOn,
  type QuickAsk,
  type QuickHandResult,
  type QuickHandsDeps
} from './live-voice-quick-hands'
import { speakableReply } from './live-voice-spoken'
import { isStopReply, pickCandidate } from './live-voice-terminal-target'

const EXCHANGES_MAX = 4
const LINE_MAX_CHARS = 300
const ROW_MAX_CHARS = 4_000
// Why a minute: long enough to answer "which one?", short enough that a
// later "the second one" about something else is not taken for an answer.
export const QUICK_ASK_TTL_MS = 60_000

export type QuickTurnDeps = {
  hands: QuickHandsDeps
  appendThread: (row: AdamThreadRow) => Promise<void>
  log: (source: string, text: string) => void
  now?: () => number
}

/** What a quick hand did with a request; null means ADAM should take it. */
export type QuickTurn = { outcome: string; result: LiveDelegateResult }

const CANCELLED: LiveDelegateResult = { ok: true, kind: 'cancelled', speak: '' }

/**
 * One answered exchange. `window` is the window's call lines when it
 * happened, so it can be put back in order among later lines.
 */
type Exchange = { lines: string[]; window: string[] }

/**
 * Where the last line of `then` sits in `now`, or -1 once it scrolled out.
 * Why by sequence, not text: the window keeps its newest lines, so `now` is
 * `then` with some lines dropped from the front and new ones added; a line
 * said twice ("ok") must not move an exchange to its later copy.
 */
function anchorIn(then: string[], now: string[]): number {
  for (let dropped = 0; dropped < then.length; dropped += 1) {
    const kept = then.slice(dropped)
    if (kept.length <= now.length && kept.every((line, at) => now[at] === line)) {
      return kept.length - 1
    }
  }
  return -1
}

export class LiveQuickTurns {
  private exchanges: Exchange[] = []
  private count = 0
  private pending: (QuickAsk & { callToken: string; expiresAt: number }) | null = null

  constructor(private readonly deps: QuickTurnDeps) {}

  /** A new call starts with no earlier quick answers and no open question. */
  reset(): void {
    this.exchanges = []
    this.pending = null
  }

  /** "Stop": an open "which one?" is dropped too. */
  dropPending(): void {
    this.pending = null
  }

  /**
   * The window's call lines with this call's quick exchanges put in among
   * them in the order they happened, newest last, at most `max`.
   */
  contextLines(windowLines: string[], max: number): string[] {
    const anchors = this.exchanges.map((exchange) => anchorIn(exchange.window, windowLines))
    const at = (index: number): string[] =>
      this.exchanges.flatMap((exchange, i) => (anchors[i] === index ? exchange.lines : []))
    // An exchange whose anchor scrolled out is older than every line shown.
    const out = at(-1)
    windowLines.forEach((line, index) => {
      out.push(line, ...at(index))
    })
    return out.slice(-max)
  }

  /**
   * Null when no quick hand answered and nothing was written, so ADAM may
   * take the request. Once `isCurrent` turns false nothing more is written
   * and the turn is cancelled, never handed to ADAM.
   */
  async tryAnswer(
    request: string,
    callToken: string,
    isCurrent: () => boolean,
    windowLines: string[] = []
  ): Promise<QuickTurn | null> {
    const now = (this.deps.now ?? Date.now)()
    const pending = this.pending
    // Why cleared first: whatever comes next that is not a clear answer
    // (a stop, a new request) ends the question.
    this.pending = null
    if (pending && isStopReply(request)) {
      return { outcome: 'cancelled', result: CANCELLED }
    }
    try {
      const chosen =
        pending && pending.callToken === callToken && now < pending.expiresAt
          ? pickCandidate(request, pending.candidates)
          : null
      // Why revalidate: runQuickHandOn acts only if that same terminal is still listed.
      const quick =
        pending && chosen
          ? await runQuickHandOn(pending.intent, chosen.handle, this.deps.hands, isCurrent)
          : await runQuickHand(request, this.deps.hands, isCurrent)
      if (quick || !isCurrent()) {
        return this.finish(quick, request, callToken, isCurrent, windowLines, now)
      }
    } catch (error) {
      // Nothing was written (any partial write is spoken instead), so ADAM
      // gets the request as if no quick hand existed.
      this.deps.log('quick-hand', error instanceof Error ? error.message : String(error))
    }
    return isCurrent() ? null : { outcome: 'cancelled', result: CANCELLED }
  }

  private finish(
    quick: QuickHandResult | null,
    request: string,
    callToken: string,
    isCurrent: () => boolean,
    window: string[],
    now: number
  ): QuickTurn {
    if (!quick || quick.cancelled || !isCurrent()) {
      return { outcome: 'cancelled', result: CANCELLED }
    }
    if (quick.ask) {
      this.pending = { ...quick.ask, callToken, expiresAt: now + QUICK_ASK_TTL_MS }
    }
    const speak = speakableReply(quick.speak)
    this.remember(callToken, request, speak, window)
    return { outcome: `quick:${quick.name}`, result: { ok: true, kind: 'answer', speak } }
  }

  /**
   * Why main writes both rows: the window leaves a delegated request and its
   * spoken answer out of its transcript (askAdam normally writes them), so
   * without this a quick exchange would be missing from ADAM's thread. Each
   * row is written on its own: a failed one does not stop the other.
   */
  private remember(callToken: string, request: string, speak: string, window: string[]): void {
    const id = `live:${callToken}:quick-${++this.count}`
    this.exchanges = [
      ...this.exchanges,
      {
        lines: [
          `Carson: ${request}`.slice(0, LINE_MAX_CHARS),
          `ADAM's quick answer: ${speak}`.slice(0, LINE_MAX_CHARS)
        ],
        window: [...window]
      }
    ].slice(-EXCHANGES_MAX)
    const rows: AdamThreadRow[] = [
      { id: `${id}:user`, role: 'user', text: request.slice(0, ROW_MAX_CHARS), voice: true },
      { id: `${id}:assistant`, role: 'assistant', text: speak, voice: true }
    ]
    void (async () => {
      for (const row of rows) {
        try {
          await this.deps.appendThread(row)
        } catch (error) {
          this.deps.log(
            'quick-hand',
            `thread row ${row.role} not saved: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    })()
  }
}
