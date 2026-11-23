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
import { pickCandidate } from './live-voice-terminal-target'

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
 * One answered exchange. `after` is the newest window call line when it
 * happened, so it can be put back in order among the window's lines.
 */
type Exchange = { lines: string[]; after: string | null }

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
    const placed = new Set<Exchange>()
    const out: string[] = []
    // An exchange whose anchor already scrolled out of the window's lines is older than all of them.
    for (const exchange of this.exchanges) {
      if (exchange.after === null || !windowLines.includes(exchange.after)) {
        out.push(...exchange.lines)
        placed.add(exchange)
      }
    }
    windowLines.forEach((line, at) => {
      out.push(line)
      for (const exchange of this.exchanges) {
        if (!placed.has(exchange) && windowLines.lastIndexOf(exchange.after ?? '') === at) {
          out.push(...exchange.lines)
          placed.add(exchange)
        }
      }
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
    this.pending = null
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
        return this.finish(quick, request, callToken, isCurrent, windowLines.at(-1) ?? null, now)
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
    after: string | null,
    now: number
  ): QuickTurn {
    if (!quick || quick.cancelled || !isCurrent()) {
      return { outcome: 'cancelled', result: CANCELLED }
    }
    if (quick.ask) {
      this.pending = { ...quick.ask, callToken, expiresAt: now + QUICK_ASK_TTL_MS }
    }
    const speak = speakableReply(quick.speak)
    this.remember(callToken, request, speak, after)
    return { outcome: `quick:${quick.name}`, result: { ok: true, kind: 'answer', speak } }
  }

  /**
   * Why main writes both rows: the window leaves a delegated request and its
   * spoken answer out of its transcript (askAdam normally writes them), so
   * without this a quick exchange would be missing from ADAM's thread. Each
   * row is written on its own: a failed one does not stop the other.
   */
  private remember(callToken: string, request: string, speak: string, after: string | null): void {
    const id = `live:${callToken}:quick-${++this.count}`
    this.exchanges = [
      ...this.exchanges,
      {
        lines: [
          `Carson: ${request}`.slice(0, LINE_MAX_CHARS),
          `ADAM's quick answer: ${speak}`.slice(0, LINE_MAX_CHARS)
        ],
        after
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
