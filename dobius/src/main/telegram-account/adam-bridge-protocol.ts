import { TextDecoder } from 'node:util'

export const ADAM_BRIDGE_FRAME_LIMIT = 128 * 1024
export const ADAM_BRIDGE_TEXT_LIMIT = 16_000
export const ADAM_BRIDGE_ERROR_CODES = new Set([
  'protocol-error',
  'request-conflict',
  'request-interrupted',
  'cancelled',
  'inference-failed',
  'gateway-busy',
  'policy-unavailable',
  'profile-unavailable',
  'gateway-unavailable',
  'output-unavailable',
  'receipt-unavailable',
  'request-not-found'
])

export type AdamBridgeFrame =
  | {
      v: 1
      type: 'ready'
      nonce: string
      profile: 'adam'
      platform: 'dobius_adam_telegram'
      policy: 'no-tools'
    }
  | { v: 1; type: 'reply'; id: string; text: string }
  | { v: 1; type: 'error'; id?: string; code: string }

/** Never interpret stdout, model content, or a permissive JSON shape as a control frame. */
export function parseAdamBridgeFrame(bytes: Uint8Array): AdamBridgeFrame {
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('protocol-error')
  }
  const f = raw as Record<string, unknown>
  const exact = (keys: string[]): boolean => Object.keys(f).every((k) => keys.includes(k))
  if (f.v !== 1) {
    throw new Error('protocol-error')
  }
  if (
    f.type === 'ready' &&
    exact(['v', 'type', 'nonce', 'profile', 'platform', 'policy']) &&
    typeof f.nonce === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(f.nonce) &&
    f.profile === 'adam' &&
    f.platform === 'dobius_adam_telegram' &&
    f.policy === 'no-tools'
  ) {
    return f as AdamBridgeFrame
  }
  if (
    f.type === 'reply' &&
    exact(['v', 'type', 'id', 'text']) &&
    validId(f.id) &&
    typeof f.text === 'string' &&
    f.text.trim().length > 0 &&
    f.text.length <= ADAM_BRIDGE_TEXT_LIMIT
  ) {
    return f as AdamBridgeFrame
  }
  if (
    f.type === 'error' &&
    exact(['v', 'type', 'id', 'code']) &&
    (f.id === undefined || validId(f.id)) &&
    typeof f.code === 'string' &&
    ADAM_BRIDGE_ERROR_CODES.has(f.code)
  ) {
    return f as AdamBridgeFrame
  }
  throw new Error('protocol-error')
}

export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^tg_[a-f0-9]{64}$/.test(value)
}

export class AdamBridgeFrameReader {
  private buffer = Buffer.alloc(0)
  constructor(private readonly consume: (frame: AdamBridgeFrame) => void) {}

  push(chunk: Buffer): void {
    let start = 0
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] !== 10) {
        continue
      }
      this.append(chunk.subarray(start, i))
      if (this.buffer.length === 0) {
        throw new Error('protocol-error')
      }
      const frame = parseAdamBridgeFrame(this.buffer)
      this.buffer = Buffer.alloc(0)
      this.consume(frame)
      start = i + 1
    }
    this.append(chunk.subarray(start))
  }

  private append(chunk: Buffer): void {
    if (this.buffer.length + chunk.length > ADAM_BRIDGE_FRAME_LIMIT) {
      throw new Error('protocol-error')
    }
    this.buffer = Buffer.concat([this.buffer, chunk])
  }
}
