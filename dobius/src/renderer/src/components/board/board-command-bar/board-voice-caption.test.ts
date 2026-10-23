import { describe, expect, it } from 'vitest'
import { boardVoiceCaptionPhase, boardVoiceCaptionText } from './board-voice-caption'

describe('boardVoiceCaptionPhase', () => {
  it('maps dictation states to caption phases', () => {
    expect(boardVoiceCaptionPhase('starting')).toBe('listening')
    expect(boardVoiceCaptionPhase('listening')).toBe('listening')
    expect(boardVoiceCaptionPhase('stopping')).toBe('processing')
    expect(boardVoiceCaptionPhase('idle')).toBeNull()
    expect(boardVoiceCaptionPhase('error')).toBeNull()
  })
})

describe('boardVoiceCaptionText', () => {
  it('shows only the live partial before any segment is final', () => {
    expect(boardVoiceCaptionText('', '', ' can you delete ')).toBe('can you delete')
  })

  it('joins finished segments typed into the draft with the live partial', () => {
    expect(boardVoiceCaptionText('', 'Thanks very much. ', 'can you delete')).toBe(
      'Thanks very much. can you delete'
    )
  })

  it('ignores text that was already in the draft before listening began', () => {
    expect(boardVoiceCaptionText('@Rafa ', '@Rafa run the tests', '')).toBe('run the tests')
  })

  it('falls back to the whole draft if it was edited away from its start', () => {
    expect(boardVoiceCaptionText('old text', 'new words', 'more')).toBe('new words more')
  })

  it('is empty when nothing has been heard', () => {
    expect(boardVoiceCaptionText('x', 'x', '  ')).toBe('')
  })
})
