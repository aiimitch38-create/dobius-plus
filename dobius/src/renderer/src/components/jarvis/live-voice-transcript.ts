const MAX_BUFFER_CHARS = 8_000
const MAX_CALL_LINES = 8
const MAX_CALL_LINE_CHARS = 300
const REPLY_START_MAX_MS = 15_000

function normalize(said: string): string {
  return said
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP =
  /^(?:(?:hey|ok|okay|no) )?(?:adam )?(?:stop|cancel|never ?mind|forget (?:it|that)|scratch that)(?: (?:it|that|please|now|adam))*$/
const HANG_UP =
  /^(?:(?:ok|okay|alright|thanks|thank you) )?(?:adam )?(?:hang up|end (?:the )?call|good ?bye|bye|that's all for now|that is all for now)(?: (?:adam|now|please|thanks|for now))*$/

/** Carson asked to drop what ADAM is doing ("stop", "never mind"). */
export function isStopIntent(said: string): boolean {
  return STOP.test(normalize(said))
}

/** Carson asked to end the call ("hang up", "goodbye"). */
export function isHangUpIntent(said: string): boolean {
  return HANG_UP.test(normalize(said))
}

export type TranscriptRecorder = (line: {
  role: 'user' | 'assistant'
  text: string
  itemId: string
}) => void

/**
 * Follows the call's two transcripts and splits them into exchanges.
 *
 * Why: in client delegation the delegation event carries no text (design doc
 * section 1.3), so Carson's request is whatever he said since the last
 * request was taken. An exchange ends when Carson starts talking again after
 * the voice spoke. Its lines are written to ADAM's thread, except the parts
 * that went to ADAM (askAdam already writes those, with his full answer).
 */
export class LiveTranscript {
  private input = ''
  private output = ''
  private delegated = false
  // Why separate from `delegated`: ADAM's spoken answer is in the thread
  // already, and it can start after Carson talked over the filler or be
  // interrupted midway. Every output delta from expectReply() until the
  // voice goes quiet after it (replyFinished) is left out of the transcript.
  private replyOwedAt: number | null = null
  private replyStarted = false
  private lastSpeaker: 'user' | 'assistant' | null = null
  private lines: string[] = []
  private exchange = 0

  constructor(
    private readonly record: TranscriptRecorder,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * `keepRequest`: a delegation is still waiting for Carson's words, so the
   * voice's filler ("On it") must not split his request in two.
   */
  addInput(delta: string, keepRequest = false): void {
    if (!delta) {
      return
    }
    if (this.lastSpeaker === 'assistant') {
      this.flush(keepRequest)
    }
    this.input = `${this.input}${delta}`.slice(-MAX_BUFFER_CHARS)
    this.lastSpeaker = 'user'
  }

  addOutput(delta: string): void {
    if (!delta) {
      return
    }
    this.lastSpeaker = 'assistant'
    // Bounded: an answer the voice never speaks stops hiding output after a while.
    if (this.replyOwedAt !== null && this.now() - this.replyOwedAt > REPLY_START_MAX_MS) {
      this.replyOwedAt = null
    }
    if (this.replyOwedAt !== null) {
      this.replyStarted = true
      return
    }
    this.output = `${this.output}${delta}`.slice(-MAX_BUFFER_CHARS)
  }

  /** The next thing the voice says is ADAM's delegated answer. */
  expectReply(): void {
    this.replyOwedAt = this.now()
    this.replyStarted = false
  }

  /** The voice went quiet: a delegated answer that had started is over. */
  replyFinished(): void {
    if (this.replyStarted) {
      this.replyOwedAt = null
      this.replyStarted = false
    }
  }

  /** The call ended: save what is left and forget any answer still owed. */
  endCall(): void {
    this.flush()
    this.replyOwedAt = null
    this.replyStarted = false
  }

  /** What Carson has said that no request has taken yet. */
  peekInput(): string {
    return this.input.trim()
  }

  /** Takes Carson's words for a delegated request. */
  takeRequest(): string {
    const request = this.input.trim()
    this.input = ''
    if (request) {
      this.delegated = true
    }
    return request
  }

  /** Drops Carson's latest words without sending or saving them (a "stop"). */
  discardInput(): void {
    this.input = ''
  }

  /** Ends the current exchange: saves what ADAM did not already get. */
  flush(keepRequest = false): void {
    const user = keepRequest ? '' : this.input.trim()
    const said = this.output.trim()
    const itemId = String(++this.exchange)
    if (user) {
      this.record({ role: 'user', text: user, itemId })
      this.remember(`Carson: ${user}`)
    }
    // Filler spoken while a request is pending ("On it") is not worth keeping.
    if (said && !this.delegated && !keepRequest) {
      this.record({ role: 'assistant', text: said, itemId })
      this.remember(`ADAM's voice: ${said}`)
    }
    this.input = keepRequest ? this.input : ''
    this.output = ''
    this.delegated = false
    this.lastSpeaker = null
  }

  /** Recent call lines ADAM never saw, so a delegated request has context. */
  recentLines(): string[] {
    return [...this.lines]
  }

  private remember(line: string): void {
    this.lines = [...this.lines, line.slice(0, MAX_CALL_LINE_CHARS)].slice(-MAX_CALL_LINES)
  }
}
