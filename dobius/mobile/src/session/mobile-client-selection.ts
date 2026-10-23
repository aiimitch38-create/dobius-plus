export type MobileClientSelection = {
  tabId: string | null
  terminalHandle: string | null
}

export type SelectableSessionTab = {
  id: string
  type: string
  terminal?: string | null
  isActive: boolean
}

type SelectionStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<unknown>
}

// Route remounts can leave an earlier controller's storage write in flight.
const storageWrites = new WeakMap<SelectionStorage, Map<string, Promise<unknown>>>()

function pendingWrites(storage: SelectionStorage): Map<string, Promise<unknown>> {
  let writes = storageWrites.get(storage)
  if (!writes) {
    writes = new Map()
    storageWrites.set(storage, writes)
  }
  return writes
}

export function mobileClientSelectionKey(hostId: string, worktreeId: string): string {
  return `dobius:clientSelection:v1:${encodeURIComponent(hostId)}:${encodeURIComponent(worktreeId)}`
}

function readSelection(raw: string | null): MobileClientSelection | null {
  if (!raw) {
    return null
  }
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid client selection')
  }
  const value = parsed as Record<string, unknown>
  if (
    !(value.tabId === null || typeof value.tabId === 'string') ||
    !(value.terminalHandle === null || typeof value.terminalHandle === 'string') ||
    (!value.tabId && !value.terminalHandle)
  ) {
    throw new Error('Invalid client selection')
  }
  return { tabId: value.tabId, terminalHandle: value.terminalHandle }
}

/** Device-local focus; published active flags are only a first-visit default. */
export class MobileClientSelectionController {
  private selection: MobileClientSelection | null = null
  private hydrated = false
  private hydrationFailed = false
  private editVersion = 0
  private hydration: Promise<void> | null = null
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly storage: SelectionStorage,
    private readonly key: string
  ) {}

  hydrate(): Promise<void> {
    if (!this.hydration) {
      const version = this.editVersion
      this.hydration = (pendingWrites(this.storage).get(this.key) ?? Promise.resolve())
        .catch(() => {})
        .then(() => this.storage.getItem(this.key))
        .then((raw) => {
          if (this.editVersion === version) {
            this.selection = readSelection(raw)
          }
        })
        .catch(() => {
          // Why: a failed read must not silently replace the saved choice with
          // whichever terminal happens to be focused on the laptop.
          this.hydrationFailed = this.editVersion === version
        })
        .then(() => {
          this.hydrated = true
        })
    }
    return this.hydration
  }

  select(tabId: string | null, terminalHandle: string | null): void {
    this.editVersion += 1
    this.hydrationFailed = false
    this.selection = { tabId, terminalHandle }
    const value = JSON.stringify(this.selection)
    // Why: delayed storage writes must not let an earlier tap win after a later one.
    const pending = pendingWrites(this.storage)
    this.writes = (pending.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.storage.setItem(this.key, value))
    pending.set(this.key, this.writes)
    const write = this.writes
    void write
      .catch(() => {})
      .then(() => {
        if (pending.get(this.key) === write) {
          pending.delete(this.key)
        }
      })
  }

  reconcile<T extends SelectableSessionTab>(
    tabs: readonly T[]
  ): {
    tab: T | null
    status: 'loading' | 'selected' | 'empty' | 'missing' | 'unavailable'
  } {
    if (!this.hydrated && !this.selection) {
      return { tab: null, status: 'loading' }
    }
    if (!this.selection) {
      if (this.hydrationFailed) {
        return { tab: null, status: 'unavailable' }
      }
      const initial = tabs.find((tab) => tab.isActive) ?? tabs[0]
      if (!initial) {
        return { tab: null, status: 'empty' }
      }
      this.select(initial.id, initial.type === 'terminal' ? (initial.terminal ?? null) : null)
    }
    const selection = this.selection!
    const byId = tabs.find((tab) => tab.id === selection.tabId)
    const selected = selection.terminalHandle
      ? tabs.find((tab) => tab.type === 'terminal' && tab.terminal === selection.terminalHandle)
      : byId
    if (!selected) {
      return { tab: null, status: 'missing' }
    }
    const handle = selected.type === 'terminal' ? (selected.terminal ?? null) : null
    if (selected.id !== selection.tabId || handle !== selection.terminalHandle) {
      this.select(selected.id, handle)
    }
    return { tab: selected, status: 'selected' }
  }

  async settled(): Promise<void> {
    await this.writes
  }
}
