import { app, ipcMain } from 'electron'
import type { Store } from './persistence'
import { readAllWhatsNewNotes, resolveWhatsNewNotesDir } from './whats-new-notes'
import { planWhatsNew, type WhatsNewPayload, type WhatsNewSection } from '../shared/whats-new'

// The one-time "What's new" popup after an update. The renderer asks once the
// main window has settled; main answers from the saved "seen" version, so the
// decision survives reloads and never depends on renderer state.

type WhatsNewStore = Pick<Store, 'getWhatsNewSeen' | 'markWhatsNewSeen' | 'hadProfileOnLoad'>

export type WhatsNewService = {
  /** Notes to show now, or null. Records the baseline on a fresh install. */
  getPending: () => WhatsNewPayload | null
  /** The person pressed Continue: never show these notes again. */
  dismiss: () => void
  /** This version's notes for the Updates settings page, in every build. */
  getCurrent: () => WhatsNewSection | null
}

export function createWhatsNewService(options: {
  store: WhatsNewStore
  currentVersion: string
  /** False keeps the popup off (dev builds sharing the real profile). */
  enabled: boolean
  readNotes: () => Map<string, string[]>
}): WhatsNewService {
  const { store, currentVersion, enabled } = options
  let notesCache: Map<string, string[]> | null = null
  const notes = (): Map<string, string[]> => {
    notesCache ??= options.readNotes()
    return notesCache
  }

  return {
    getPending() {
      if (!enabled) {
        return null
      }
      const plan = planWhatsNew({
        current: currentVersion,
        seen: store.getWhatsNewSeen(),
        existingProfile: store.hadProfileOnLoad(),
        notes: notes()
      })
      if (plan.newSeen) {
        store.markWhatsNewSeen(plan.newSeen)
      }
      return plan.sections.length > 0 ? { sections: plan.sections } : null
    },
    dismiss() {
      if (enabled) {
        store.markWhatsNewSeen(currentVersion)
      }
    },
    getCurrent() {
      const bullets = notes().get(currentVersion)
      return bullets ? { version: currentVersion, bullets } : null
    }
  }
}

/**
 * Why off in dev: a dev copy running next to the installed app on the same
 * profile would show the notes twice and race the write. DOBIUS_WHATS_NEW=1
 * turns it on for an isolated test copy.
 */
export function isWhatsNewEnabled(): boolean {
  return app.isPackaged || process.env.DOBIUS_WHATS_NEW === '1'
}

export function registerWhatsNewHandlers(store: Store): void {
  const service = createWhatsNewService({
    store,
    currentVersion: app.getVersion(),
    enabled: isWhatsNewEnabled(),
    readNotes: () => {
      const { notes, bad } = readAllWhatsNewNotes(resolveWhatsNewNotesDir())
      if (bad.length > 0) {
        console.warn('[whats-new] notes skipped:', bad.join('; '))
      }
      return notes
    }
  })

  ipcMain.removeHandler('whatsNew:getPending')
  ipcMain.removeHandler('whatsNew:dismiss')
  ipcMain.removeHandler('whatsNew:getCurrent')

  ipcMain.handle('whatsNew:getPending', () => service.getPending())
  ipcMain.handle('whatsNew:dismiss', () => service.dismiss())
  ipcMain.handle('whatsNew:getCurrent', () => service.getCurrent())
}
