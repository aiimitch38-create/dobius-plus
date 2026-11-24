// Every text outside TextIntake's per-send Touch ID (destinations, the bridge's
// own replies and test text, the conductor, the brief's code) goes only to a
// handle Carson approved with Touch ID when he saved it, or to the 7.16
// verified self handle (Codex on 90c6848c). sendImessage checks it, so no
// caller can skip it. A handle saved before this has no approval and stops
// receiving texts until it is saved again with Touch ID.
import { join } from 'node:path'
import { SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'
import { canonicalHandle } from '../text-intake/contact-handle'
import { requireTouchId } from './touch-id-gate'

const MAX_APPROVED = 200

export type ApprovedHandleStore = { list: () => string[]; save: (handles: string[]) => void }

function fileStore(): ApprovedHandleStore {
  const file = new SafeJsonFile<{ handles: string[] }>({
    filePath: () => join(getUserDataRoot(), 'imessage-approved-handles.json'),
    parse: (raw) => {
      const handles = (raw as { handles?: unknown } | null)?.handles
      return Array.isArray(handles) && handles.every((h) => typeof h === 'string')
        ? { handles: handles as string[] }
        : undefined
    },
    fallback: () => ({ handles: [] }),
    // Why private: phone numbers and emails.
    mode: 0o600,
    label: '[imessage-bridge] imessage-approved-handles.json'
  })
  return { list: () => file.get().handles, save: (handles) => file.save({ handles }) }
}

let store: ApprovedHandleStore | null = null
let verifiedSelfHandle: () => string | null = () => null

export function setApprovedHandleStoreForTest(next: ApprovedHandleStore | null): void {
  store = next
}

/** Set by ADAM speaks up (7.16): the self handle Carson proved with a texted code, or null. */
export function setVerifiedSelfHandleSource(source: () => string | null): void {
  verifiedSelfHandle = source
}

function approvedStore(): ApprovedHandleStore {
  store ??= fileStore()
  return store
}

export function notApprovedError(handle: string): string {
  return `${handle} is not approved for texts from Dobius+. Save it again in Settings and confirm with Touch ID.`
}

export function isApprovedImessageHandle(handle: string): boolean {
  const canonical = canonicalHandle(handle)
  if (!canonical) {
    return false
  }
  const verified = verifiedSelfHandle()
  return (verified !== null && canonicalHandle(verified) === canonical) || approvedStore().list().includes(canonical)
}

/** Throws unless `handle` is approved or the verified self handle. */
export function assertApprovedImessageHandle(handle: string): void {
  if (!isApprovedImessageHandle(handle)) {
    throw new Error(notApprovedError(handle))
  }
}

/**
 * Called when a handle is saved (a destination, the bridge's selfHandle):
 * Touch ID "allow Dobius+ to text <handle>", then the approval is stored.
 * Null when approved (now or before); otherwise why not.
 */
export async function approveImessageHandle(
  handle: string,
  touchId: (reason: string) => Promise<string | null> = requireTouchId
): Promise<string | null> {
  const trimmed = handle.trim()
  if (!trimmed) {
    return null
  }
  if (isApprovedImessageHandle(trimmed)) {
    return null
  }
  const refused = await touchId(`allow Dobius+ to text ${trimmed}`)
  if (refused) {
    return `${trimmed} was not saved: ${refused}`
  }
  const canonical = canonicalHandle(trimmed)
  const next = [...approvedStore().list().filter((h) => h !== canonical), canonical].slice(-MAX_APPROVED)
  try {
    approvedStore().save(next)
  } catch (error) {
    return `${trimmed} was confirmed but could not be saved: ${error instanceof Error ? error.message : String(error)}`
  }
  return null
}
