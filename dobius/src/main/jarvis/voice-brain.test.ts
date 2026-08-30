import { describe, expect, it, vi } from 'vitest'
import type { BrainStreamMessage, BrainUserMessage } from './voice-brain'
import { VoiceBrain } from './voice-brain'

function delta(text: string): BrainStreamMessage {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } }
  }
}

const RESULT: BrainStreamMessage = { type: 'result', subtype: 'success' }

/** A scripted SDK session: replies with a fixed message batch per user turn. */
function makeFakeSession(turns: BrainStreamMessage[][]): {
  openQuery: (input: AsyncIterable<BrainUserMessage>) => AsyncIterable<BrainStreamMessage> & {
    close: () => void
  }
  openCount: () => number
  received: BrainUserMessage[]
  closed: () => boolean
} {
  let opened = 0
  let closed = false
  const received: BrainUserMessage[] = []
  const openQuery = (
    input: AsyncIterable<BrainUserMessage>
  ): AsyncIterable<BrainStreamMessage> & { close: () => void } => {
    opened += 1
    const inputIterator = input[Symbol.asyncIterator]()
    return {
      close: () => {
        closed = true
      },
      async *[Symbol.asyncIterator]() {
        for (const turn of turns) {
          const user = await inputIterator.next()
          if (user.done) {
            return
          }
          received.push(user.value)
          yield* turn
        }
      }
    }
  }
  return { openQuery, openCount: () => opened, received, closed: () => closed }
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const value of iterable) {
    out.push(value)
  }
  return out
}

describe('VoiceBrain.ask', () => {
  it('yields sentences as deltas stream in, flushing the tail at result', async () => {
    const fake = makeFakeSession([
      [delta('The build is gr'), delta('een. Two tests were flaky'), delta(' yesterday'), RESULT]
    ])
    const brain = new VoiceBrain({ openQuery: fake.openQuery })
    const sentences = await collect(brain.ask('status?'))
    expect(sentences).toEqual(['The build is green.', 'Two tests were flaky yesterday'])
    expect(fake.received[0]?.message.content).toBe('status?')
  })

  it('keeps ONE session warm across turns', async () => {
    const fake = makeFakeSession([
      [delta('First answer. '), RESULT],
      [delta('Second answer. '), RESULT]
    ])
    const brain = new VoiceBrain({ openQuery: fake.openQuery })
    expect(await collect(brain.ask('one'))).toEqual(['First answer.'])
    expect(await collect(brain.ask('two'))).toEqual(['Second answer.'])
    expect(fake.openCount()).toBe(1)
  })

  it('serializes concurrent asks so sentences never interleave', async () => {
    const fake = makeFakeSession([
      [delta('Turn one. '), RESULT],
      [delta('Turn two. '), RESULT]
    ])
    const brain = new VoiceBrain({ openQuery: fake.openQuery })
    const [first, second] = await Promise.all([
      collect(brain.ask('one')),
      collect(brain.ask('two'))
    ])
    expect(first).toEqual(['Turn one.'])
    expect(second).toEqual(['Turn two.'])
  })

  it('a failed turn subtype throws (caller falls back to ADAM)', async () => {
    const fake = makeFakeSession([[delta('Partial'), { type: 'result', subtype: 'error_max_turns' }]])
    const brain = new VoiceBrain({ openQuery: fake.openQuery })
    await expect(collect(brain.ask('x'))).rejects.toThrow('error_max_turns')
  })

  it('a stream that dies drops the session so the next ask reopens', async () => {
    let calls = 0
    const openQuery = (): AsyncIterable<BrainStreamMessage> & { close: () => void } => {
      calls += 1
      const attempt = calls
      return {
        close: vi.fn(),
        async *[Symbol.asyncIterator]() {
          if (attempt === 1) {
            throw new Error('subprocess died')
          }
          yield delta('Recovered. ')
          yield RESULT
        }
      }
    }
    const brain = new VoiceBrain({ openQuery })
    await expect(collect(brain.ask('x'))).rejects.toThrow('subprocess died')
    expect(await collect(brain.ask('again'))).toEqual(['Recovered.'])
    expect(calls).toBe(2)
  })

  it('dispose closes the underlying query', async () => {
    const fake = makeFakeSession([[delta('Hi. '), RESULT]])
    const brain = new VoiceBrain({ openQuery: fake.openQuery })
    await collect(brain.ask('hello'))
    brain.dispose()
    expect(fake.closed()).toBe(true)
  })
})
