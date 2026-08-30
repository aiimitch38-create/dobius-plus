import { createSentenceSplitter } from './sentence-stream'

/**
 * The subset of Claude Agent SDK message shapes the brain consumes. Kept
 * structural (not imported from the SDK) so tests can drive plain objects and
 * the SDK stays lazily loaded — it spawns a subprocess on first use.
 */
export type BrainStreamMessage = {
  type: string
  subtype?: string
  event?: {
    type: string
    delta?: { type: string; text?: string }
  }
}

export type BrainUserMessage = {
  type: 'user'
  message: { role: 'user'; content: string }
  parent_tool_use_id: null
}

export type BrainQuery = AsyncIterable<BrainStreamMessage> & { close?: () => void }

export type VoiceBrainDeps = {
  /** Opens ONE persistent streaming conversation. Default: the real SDK. */
  openQuery?: (input: AsyncIterable<BrainUserMessage>) => BrainQuery
  systemPrompt?: string
}

/**
 * Spoken Adam: terse, direct, and safe to pipe straight into TTS. The words
 * ARE the interface — no markdown, no lists, nothing that reads badly aloud.
 */
export const VOICE_BRAIN_SYSTEM_PROMPT = [
  'You are Adam, the spoken voice of the Dobius+ desktop app, talking to Carson.',
  'Answers are spoken aloud by a TTS engine, so: short sentences, plain words,',
  'no markdown, no bullet points, no code blocks, no emoji. Two or three',
  'sentences is a full answer; one is often enough. Never narrate what you are',
  'about to say, never describe your own limitations unprompted, and never end',
  'a reply with a question you do not need answered. If you genuinely cannot',
  'answer, say so in one short sentence.'
].join(' ')

/** Unbounded async queue bridging push-style asks into the SDK's pull stream. */
function createAsyncQueue<T>(): {
  push: (value: T) => void
  iterable: AsyncIterable<T>
} {
  const values: T[] = []
  let wake: (() => void) | null = null
  return {
    push(value: T) {
      values.push(value)
      wake?.()
      wake = null
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (values.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
          yield values.shift() as T
        }
      }
    }
  }
}

/**
 * A persistent, warm Claude conversation that yields SENTENCES as they
 * stream. One SDK subprocess is opened lazily on the first ask and reused —
 * the ~20s cold start (measured 2026-08-30) is paid once, not per turn.
 *
 * The brain only talks. `allowedTools: []` in the default opener means acting
 * on the system stays with the existing ADAM tool path.
 */
export class VoiceBrain {
  private readonly deps: VoiceBrainDeps
  private session: {
    push: (value: BrainUserMessage) => void
    stream: AsyncIterator<BrainStreamMessage>
    query: BrainQuery
  } | null = null
  private turnLock: Promise<void> = Promise.resolve()

  constructor(deps: VoiceBrainDeps = {}) {
    this.deps = deps
  }

  /**
   * Yields complete sentences for one spoken turn. Turns are serialized: a
   * second ask waits for the first to finish, because both read the same
   * message stream and interleaved turns would cross their sentences.
   */
  async *ask(utterance: string): AsyncIterable<string> {
    let releaseTurn!: () => void
    const previousTurn = this.turnLock
    this.turnLock = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })
    await previousTurn
    try {
      const session = this.openSessionIfNeeded()
      session.push({
        type: 'user',
        message: { role: 'user', content: utterance },
        parent_tool_use_id: null
      })
      const splitter = createSentenceSplitter()
      for (;;) {
        let next: IteratorResult<BrainStreamMessage>
        try {
          next = await session.stream.next()
        } catch (error) {
          // A dead subprocess must not be reused for the next turn.
          this.dispose()
          throw error
        }
        if (next.done) {
          this.dispose()
          throw new Error('Voice brain stream ended unexpectedly')
        }
        const msg = next.value
        if (
          msg.type === 'stream_event' &&
          msg.event?.type === 'content_block_delta' &&
          msg.event.delta?.type === 'text_delta'
        ) {
          yield* splitter.push(msg.event.delta.text ?? '')
        } else if (msg.type === 'result') {
          if (msg.subtype && msg.subtype !== 'success') {
            throw new Error(`Voice brain turn failed: ${msg.subtype}`)
          }
          const tail = splitter.flush()
          if (tail) {
            yield tail
          }
          return
        }
      }
    } finally {
      releaseTurn()
    }
  }

  dispose(): void {
    try {
      this.session?.query.close?.()
    } catch {
      // Why tolerated: close() on an already-dead subprocess throws in some
      // SDK versions; disposal must still null the session either way.
    }
    this.session = null
  }

  private openSessionIfNeeded(): NonNullable<typeof this.session> {
    if (this.session) {
      return this.session
    }
    const queue = createAsyncQueue<BrainUserMessage>()
    const openQuery = this.deps.openQuery ?? defaultOpenQuery(this.deps.systemPrompt)
    const query = openQuery(queue.iterable)
    this.session = {
      push: queue.push,
      stream: query[Symbol.asyncIterator](),
      query
    }
    return this.session
  }
}

function defaultOpenQuery(
  systemPrompt = VOICE_BRAIN_SYSTEM_PROMPT
): (input: AsyncIterable<BrainUserMessage>) => BrainQuery {
  return (input) => {
    // Lazy: requiring the SDK spawns nothing, but query() forks the CLI
    // subprocess — this must not happen at app startup (16 GB rule).

    const sdk = require('@anthropic-ai/claude-agent-sdk') as {
      query: (params: { prompt: AsyncIterable<BrainUserMessage>; options: object }) => BrainQuery
    }
    return sdk.query({
      prompt: input,
      options: {
        systemPrompt,
        includePartialMessages: true,
        allowedTools: [],
        maxTurns: 1
      }
    })
  }
}
