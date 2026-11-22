import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.0.0', getAppPath: () => process.cwd() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

const { createWhatsNewService } = await import('./whats-new')
const { readAllWhatsNewNotes } = await import('./whats-new-notes')

function fakeStore(seen: string | null, existingProfile: boolean) {
  const state = { seen }
  return {
    state,
    getWhatsNewSeen: () => state.seen,
    hadProfileOnLoad: () => existingProfile,
    markWhatsNewSeen: vi.fn((version: string) => {
      state.seen = version
    })
  }
}

const NOTES = new Map([
  ['2.1.9', ['Nine.']],
  ['2.1.10', ['Ten.']]
])

describe('createWhatsNewService', () => {
  it('shows the notes until dismissed, then never again', () => {
    const store = fakeStore('2.1.9', true)
    const service = createWhatsNewService({
      store,
      currentVersion: '2.1.10',
      enabled: true,
      readNotes: () => NOTES
    })

    const expected = { sections: [{ version: '2.1.10', bullets: ['Ten.'] }] }
    expect(service.getPending()).toEqual(expected)
    // A reload before Continue asks again and still gets the notes.
    expect(service.getPending()).toEqual(expected)
    expect(store.markWhatsNewSeen).not.toHaveBeenCalled()

    service.dismiss()
    expect(store.state.seen).toBe('2.1.10')
    expect(service.getPending()).toBeNull()
  })

  it('records the baseline on a first install without showing anything', () => {
    const store = fakeStore(null, false)
    const service = createWhatsNewService({
      store,
      currentVersion: '2.1.10',
      enabled: true,
      readNotes: () => NOTES
    })
    expect(service.getPending()).toBeNull()
    expect(store.state.seen).toBe('2.1.10')
  })

  it('stays off and writes nothing when disabled, but still serves the settings notes', () => {
    const store = fakeStore('2.1.9', true)
    const service = createWhatsNewService({
      store,
      currentVersion: '2.1.10',
      enabled: false,
      readNotes: () => NOTES
    })
    expect(service.getPending()).toBeNull()
    service.dismiss()
    expect(store.markWhatsNewSeen).not.toHaveBeenCalled()
    expect(service.getCurrent()).toEqual({ version: '2.1.10', bullets: ['Ten.'] })
  })

  it('has no settings notes for a version without a file', () => {
    const service = createWhatsNewService({
      store: fakeStore(null, true),
      currentVersion: '2.1.11',
      enabled: true,
      readNotes: () => NOTES
    })
    expect(service.getCurrent()).toBeNull()
  })
})

describe('bundled notes files', () => {
  it('every file in resources/whats-new parses', () => {
    const { notes, bad } = readAllWhatsNewNotes(join(process.cwd(), 'resources', 'whats-new'))
    expect(bad).toEqual([])
    expect(notes.size).toBeGreaterThan(0)
  })

  it('reports a missing folder instead of throwing', () => {
    const { notes, bad } = readAllWhatsNewNotes(join(process.cwd(), 'no-such-whats-new-folder'))
    expect(notes.size).toBe(0)
    expect(bad).toHaveLength(1)
  })
})
