import { createHash } from 'node:crypto'
import type { Action } from './schema.js'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  return value
}

export function canonicalAction(action: Action): string {
  return JSON.stringify(canonicalize(action))
}

export function actionDigest(action: Action): string {
  return createHash('sha256').update(canonicalAction(action)).digest('hex')
}

