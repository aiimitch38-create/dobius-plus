import { createHmac, randomBytes } from 'node:crypto'

export type LayaAuthorityEpochReader = { current(): unknown }
export type LayaAuthorityEpochTicket = number

export function captureAuthorityEpoch(
  reader: LayaAuthorityEpochReader | undefined
): LayaAuthorityEpochTicket | null {
  if (!reader) {
    return null
  }
  try {
    const epoch = reader.current()
    return Number.isSafeInteger(epoch) &&
      Number(epoch) >= 0 &&
      Number(epoch) < Number.MAX_SAFE_INTEGER
      ? Number(epoch)
      : null
  } catch {
    return null
  }
}

export function authorityEpochMatches(
  reader: LayaAuthorityEpochReader | undefined,
  ticket: LayaAuthorityEpochTicket
): boolean {
  return captureAuthorityEpoch(reader) === ticket
}

export function createRevisionDigestKey(): Buffer {
  return randomBytes(32)
}

export function opaqueSourceRevision(key: Buffer, sourceRevision: string): string {
  return createHmac('sha256', key)
    .update('dobius:laya:snapshot-revision:v1\0')
    .update(sourceRevision)
    .digest('hex')
}
