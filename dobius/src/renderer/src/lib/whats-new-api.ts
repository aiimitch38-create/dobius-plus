import type { PreloadApi } from '../../../preload/api-types'
import {
  readWhatsNewPayload,
  readWhatsNewSection,
  type WhatsNewPayload,
  type WhatsNewSection
} from '../../../shared/whats-new'

// Why Partial: the web build and older test stubs have no `whatsNew` API; the
// popup must then stay quiet instead of throwing.
function whatsNewApi(): Partial<PreloadApi['whatsNew']> {
  return (window.api as Partial<PreloadApi>).whatsNew ?? {}
}

/** Notes to show once after an update, or null when there is nothing to show. */
export async function fetchPendingWhatsNew(): Promise<WhatsNewPayload | null> {
  const getPending = whatsNewApi().getPending
  return getPending ? readWhatsNewPayload(await getPending()) : null
}

/** The running version's notes, or null when none were written for it. */
export async function fetchCurrentWhatsNew(): Promise<WhatsNewSection | null> {
  const getCurrent = whatsNewApi().getCurrent
  return getCurrent ? readWhatsNewSection(await getCurrent()) : null
}

/** Marks the running version's notes as read. */
export async function dismissWhatsNew(): Promise<void> {
  await whatsNewApi().dismiss?.()
}
