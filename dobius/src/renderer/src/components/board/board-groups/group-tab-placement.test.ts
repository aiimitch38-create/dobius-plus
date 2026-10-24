import { describe, expect, it } from 'vitest'
import { GROUP_TAB_HEIGHT, groupTabOffset } from './group-tab-placement'

const base = { frameTop: 100, frameHeight: 500, zoom: 1, viewportY: 0, safeTopPx: 72 }

describe('groupTabOffset', () => {
  it('keeps the tab on the frame edge when it is below the top chrome', () => {
    expect(groupTabOffset(base)).toBe(0)
  })

  it('slides the tab down inside the frame when the edge is under the top bar', () => {
    // Edge at screen y 40: tab top at 26 < 72, so move 46px down.
    const offset = groupTabOffset({ ...base, viewportY: -60 })
    expect(offset).toBe(46)
    const tabTopScreen = (base.frameTop + offset - GROUP_TAB_HEIGHT / 2) * base.zoom - 60
    expect(tabTopScreen).toBe(72)
  })

  it('accounts for zoom (offset is world px)', () => {
    // zoom 0.5: tab top screen = (100 - 14) * 0.5 - 40 = 3; needs 69 screen px = 138 world px.
    expect(groupTabOffset({ ...base, zoom: 0.5, viewportY: -40 })).toBe(138)
  })

  it('never pushes the tab out of the bottom of its frame', () => {
    expect(groupTabOffset({ ...base, frameHeight: 60, viewportY: -1000 })).toBe(
      60 - GROUP_TAB_HEIGHT / 2
    )
  })
})
