import { describe, expect, it, vi } from 'vitest'
import { parseBoardMention } from './board-mention'
import {
  boardReplyDraft,
  onCommandBarPrefill,
  requestCommandBarPrefill
} from './board-command-prefill'

describe('board command prefill', () => {
  it('builds a reply draft the mention parser routes to that console', () => {
    const draft = boardReplyDraft('  Code reviewer ')
    expect(draft).toBe('@Code reviewer ')
    expect(parseBoardMention(`${draft}fix it`, [{ id: 'a', name: 'Code reviewer' }])).toEqual({
      target: { id: 'a', name: 'Code reviewer' },
      message: 'fix it'
    })
  })

  it('delivers to subscribers until they unsubscribe', () => {
    const listener = vi.fn()
    const off = onCommandBarPrefill(listener)
    requestCommandBarPrefill('@A ')
    off()
    requestCommandBarPrefill('@B ')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('@A ')
  })
})
