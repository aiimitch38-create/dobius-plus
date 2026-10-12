import { describe, expect, it } from 'vitest'
import {
  decodeBrowserScreencastFrame,
  encodeBrowserScreencastFrame,
  BrowserScreencastOpcode
} from './browser-screencast-protocol'
import {
  decodeDesktopScreenFrame,
  encodeDesktopScreenFrame,
  matchesDesktopScreenSession,
  type DesktopScreenFrame
} from './desktop-screen-protocol'

const frame: DesktopScreenFrame = {
  subscriptionId: '00000000-0000-4000-8000-000000000001',
  generation: '00000000-0000-4000-8000-000000000002',
  displayId: 1,
  sequence: 1,
  width: 1280,
  height: 832,
  image: new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
}
describe('desktop screen binary isolation', () => {
  it('round trips and never enters the browser decoder', () => {
    const bytes = encodeDesktopScreenFrame(frame)
    expect(decodeDesktopScreenFrame(bytes)).toEqual(frame)
    expect(decodeBrowserScreencastFrame(bytes)).toBeNull()
    expect(
      decodeDesktopScreenFrame(
        encodeBrowserScreencastFrame({
          opcode: BrowserScreencastOpcode.Frame,
          seq: 1,
          format: 'jpeg',
          metadata: {},
          image: frame.image
        })
      )
    ).toBeNull()
  })
  it('rejects wrong sessions, generations, displays and stale sequences', () => {
    expect(matchesDesktopScreenSession(frame, frame, 0)).toBe(true)
    expect(matchesDesktopScreenSession(frame, frame, 1)).toBe(false)
    for (const mismatch of [
      { subscriptionId: frame.generation },
      { generation: frame.subscriptionId },
      { displayId: 2 }
    ]) {
      expect(matchesDesktopScreenSession(frame, { ...frame, ...mismatch }, 0)).toBe(false)
    }
  })
  it('rejects hostile lengths, versions, dimensions and truncated JPEGs before accepting a frame', () => {
    const bytes = encodeDesktopScreenFrame(frame)
    for (const length of [0, 16, 91, bytes.length - 1]) {
      expect(decodeDesktopScreenFrame(bytes.subarray(0, length))).toBeNull()
    }
    for (const [offset, value] of [
      [1, 2],
      [3, 1],
      [16, 0],
      [12, 0xff],
      [13, 0xff],
      [20, 0],
      [92, 0]
    ]) {
      const corrupt = bytes.slice()
      corrupt[offset] = value
      expect(decodeDesktopScreenFrame(corrupt)).toBeNull()
    }
    expect(() =>
      encodeDesktopScreenFrame({ ...frame, image: new Uint8Array(1024 * 1024 + 1) })
    ).toThrow('invalid_desktop_screen_frame')
  })
})
