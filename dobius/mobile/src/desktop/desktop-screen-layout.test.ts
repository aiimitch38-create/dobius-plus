import { describe, expect, it } from 'vitest'
import { getDesktopScreenLayout } from './desktop-screen-layout'

describe('desktop mirror layout', () => {
  it('uses portrait chrome until the window becomes wider than it is tall', () => {
    expect(getDesktopScreenLayout(390, 844)).toEqual({
      isLandscape: false,
      fullScreen: false,
      showHeader: true,
      showControls: true
    })
    expect(getDesktopScreenLayout(844, 390)).toEqual({
      isLandscape: true,
      fullScreen: true,
      showHeader: false,
      showControls: false
    })
  })
})
