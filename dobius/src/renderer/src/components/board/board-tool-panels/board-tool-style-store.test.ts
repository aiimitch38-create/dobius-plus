import { describe, expect, it } from 'vitest'
import { getBoardToolStyle, useBoardToolStyle } from './board-tool-style-store'

describe('board tool style store', () => {
  it('keeps each tool’s style separate', () => {
    useBoardToolStyle.getState().setStyle('shape', { fill: 'blue', opacity: 60 })
    useBoardToolStyle.getState().setShape('arrow')
    expect(getBoardToolStyle('shape')).toMatchObject({
      shape: 'arrow',
      style: { fill: 'blue', opacity: 60 }
    })
    expect(getBoardToolStyle('pen').style.fill).toBe('none')
  })
})
