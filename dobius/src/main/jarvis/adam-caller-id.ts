// Proof that a runtime call comes from ADAM's own Hermes process: a random id
// made once per app run and handed only to the Hermes child's environment
// (adam-hermes-runtime.ts). Terminals and agents never get it, so
// `dobius adam notify` run anywhere else is refused.
import { randomBytes, timingSafeEqual } from 'node:crypto'

/** The environment variable ADAM's Hermes process (and the commands it runs) carries. */
export const ADAM_CALLER_ID_ENV = 'DOBIUS_ADAM_CALLER_ID'

let id: string | null = null

export function adamCallerId(): string {
  id ??= randomBytes(24).toString('hex')
  return id
}

export function isAdamCallerId(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false
  }
  const expected = Buffer.from(adamCallerId())
  const given = Buffer.from(value)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
