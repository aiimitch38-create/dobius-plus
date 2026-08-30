import { describe, expect, it } from 'vitest'
import { createSilenceEndpointer } from './silence-endpointer'

const CHUNK_S = 0.1

function feedFrames(
  endpointer: ReturnType<typeof createSilenceEndpointer>,
  pattern: string
): number[] {
  // 's' = speech frame, '.' = non-speech frame; returns endOfTurn indices.
  const fired: number[] = []
  for (let i = 0; i < pattern.length; i += 1) {
    const { endOfTurn } = endpointer.feed({ isSpeech: pattern[i] === 's', durationS: CHUNK_S })
    if (endOfTurn) {
      fired.push(i)
    }
  }
  return fired
}

describe('createSilenceEndpointer', () => {
  it('never fires on silence alone — noise cannot open a turn', () => {
    const endpointer = createSilenceEndpointer({ silenceWindowS: 0.6 })
    expect(feedFrames(endpointer, '....................')).toEqual([])
  })

  it('fires once after 0.6s of trailing silence following speech', () => {
    const endpointer = createSilenceEndpointer({ silenceWindowS: 0.6 })
    // 3 speech frames, then silence: fires at the 6th silence frame (0.6s).
    expect(feedFrames(endpointer, 'sss........')).toEqual([8])
  })

  it('speech resets the trailing-silence window', () => {
    const endpointer = createSilenceEndpointer({ silenceWindowS: 0.6 })
    // 5 silence frames, speech again, then a full window.
    expect(feedFrames(endpointer, 'ss.....s......')).toEqual([13])
  })

  it('does not fire again without new speech', () => {
    const endpointer = createSilenceEndpointer({ silenceWindowS: 0.6 })
    expect(feedFrames(endpointer, 'ss......................')).toEqual([7])
  })

  it('reset() clears heard speech', () => {
    const endpointer = createSilenceEndpointer({ silenceWindowS: 0.6 })
    endpointer.feed({ isSpeech: true, durationS: CHUNK_S })
    endpointer.reset()
    expect(feedFrames(endpointer, '..........')).toEqual([])
  })
})
