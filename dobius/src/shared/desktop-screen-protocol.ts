// Desktop pixels have their own kind and session identity, never browser routing.
export const DESKTOP_SCREEN_KIND = 0x73
export const DESKTOP_SCREEN_HEADER_BYTES = 92
export const DESKTOP_SCREEN_MAX_JPEG_BYTES = 1024 * 1024
export const DESKTOP_SCREEN_CAPABILITY = 'screen.desktop-view.v1' as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type DesktopScreenSession = {
  subscriptionId: string
  generation: string
  displayId: number
}
export type DesktopScreenFrame = DesktopScreenSession & {
  sequence: number
  width: number
  height: number
  image: Uint8Array
}

function validFrame(frame: DesktopScreenFrame): boolean {
  return (
    UUID.test(frame.subscriptionId) &&
    UUID.test(frame.generation) &&
    Number.isInteger(frame.sequence) &&
    frame.sequence > 0 &&
    frame.sequence <= 0xffffffff &&
    Number.isInteger(frame.displayId) &&
    frame.displayId >= 0 &&
    frame.displayId <= 0xffffffff &&
    Number.isInteger(frame.width) &&
    frame.width > 0 &&
    frame.width <= 1280 &&
    Number.isInteger(frame.height) &&
    frame.height > 0 &&
    frame.height <= 1280 &&
    frame.width * frame.height <= 1638400 &&
    frame.image.byteLength >= 4 &&
    frame.image.byteLength <= DESKTOP_SCREEN_MAX_JPEG_BYTES &&
    frame.image[0] === 0xff &&
    frame.image[1] === 0xd8 &&
    frame.image.at(-2) === 0xff &&
    frame.image.at(-1) === 0xd9
  )
}

export function encodeDesktopScreenFrame(frame: DesktopScreenFrame): Uint8Array {
  if (!validFrame(frame)) {
    throw new Error('invalid_desktop_screen_frame')
  }
  const bytes = new Uint8Array(DESKTOP_SCREEN_HEADER_BYTES + frame.image.byteLength)
  const view = new DataView(bytes.buffer)
  bytes.set([DESKTOP_SCREEN_KIND, 1, 1, 0]) // Version 1, JPEG, reserved.
  view.setUint32(4, frame.sequence, true)
  view.setUint32(8, frame.displayId, true)
  view.setUint16(12, frame.width, true)
  view.setUint16(14, frame.height, true)
  view.setUint32(16, frame.image.byteLength, true)
  bytes.set(new TextEncoder().encode(frame.subscriptionId), 20)
  bytes.set(new TextEncoder().encode(frame.generation), 56)
  bytes.set(frame.image, DESKTOP_SCREEN_HEADER_BYTES)
  return bytes
}

export function decodeDesktopScreenFrame(bytes: Uint8Array): DesktopScreenFrame | null {
  if (
    bytes.byteLength < DESKTOP_SCREEN_HEADER_BYTES + 4 ||
    bytes.byteLength > DESKTOP_SCREEN_HEADER_BYTES + DESKTOP_SCREEN_MAX_JPEG_BYTES
  ) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes[0] !== DESKTOP_SCREEN_KIND ||
    bytes[1] !== 1 ||
    bytes[2] !== 1 ||
    bytes[3] !== 0 ||
    view.getUint32(16, true) !== bytes.byteLength - DESKTOP_SCREEN_HEADER_BYTES
  ) {
    return null
  }
  const frame: DesktopScreenFrame = {
    subscriptionId: new TextDecoder().decode(bytes.subarray(20, 56)),
    generation: new TextDecoder().decode(bytes.subarray(56, 92)),
    sequence: view.getUint32(4, true),
    displayId: view.getUint32(8, true),
    width: view.getUint16(12, true),
    height: view.getUint16(14, true),
    image: bytes.subarray(DESKTOP_SCREEN_HEADER_BYTES)
  }
  return validFrame(frame) ? frame : null
}

export function matchesDesktopScreenSession(
  frame: DesktopScreenFrame,
  session: DesktopScreenSession,
  lastSequence: number
): boolean {
  return (
    frame.subscriptionId === session.subscriptionId &&
    frame.generation === session.generation &&
    frame.displayId === session.displayId &&
    frame.sequence > lastSequence
  )
}
