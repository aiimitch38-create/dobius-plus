export type DecodedMessageBody = {
  text: string | null
  source: 'text' | 'attributedBody' | null
  error?: 'malformed_attributed_body' | 'empty_body'
}

function clean(value: string): string {
  return value.replace(/\u0000/g, '').replace(/\ufffc/g, '').trim()
}

function decodeNSStringArchive(blob: Uint8Array): string | null {
  const buffer = Buffer.from(blob)
  const marker = Buffer.from('NSString')
  const markerAt = buffer.indexOf(marker)
  if (markerAt < 0) return null

  // Production Messages typedstreams use five metadata bytes after NSString,
  // followed by either a one-byte length or 0x81 + uint16LE. Scanning arbitrary
  // nearby bytes accepted the metadata '+' byte as a one-character message.
  const lengthAt = markerAt + marker.length + 5
  const tag = buffer[lengthAt]
  if (tag === undefined) return null
  let length: number
  let textAt: number
  if (tag === 0x81 && lengthAt + 2 < buffer.length) {
    length = buffer.readUInt16LE(lengthAt + 1)
    textAt = lengthAt + 3
  } else if (tag === 0x82 && lengthAt + 4 < buffer.length) {
    length = buffer.readUInt32LE(lengthAt + 1)
    textAt = lengthAt + 5
  } else {
    length = tag
    textAt = lengthAt + 1
  }
  if (length <= 0 || length > 1_000_000 || textAt + length > buffer.length) return null
  const candidate = clean(buffer.subarray(textAt, textAt + length).toString('utf8'))
  return candidate && !candidate.includes('\ufffd') ? candidate : null
}

export function decodeMessageBody(text: string | null, attributedBody: Uint8Array | null): DecodedMessageBody {
  if (text !== null && clean(text)) return { text: clean(text), source: 'text' }
  if (!attributedBody?.length) return { text: null, source: null, error: 'empty_body' }
  const decoded = decodeNSStringArchive(attributedBody)
  return decoded
    ? { text: decoded, source: 'attributedBody' }
    : { text: null, source: null, error: 'malformed_attributed_body' }
}
