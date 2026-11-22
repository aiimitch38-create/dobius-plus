import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { bringBackSnoozedTab } from '@/lib/tab-snooze/snoozed-tab-actions'
import {
  createSerialLook,
  runSnoozeReturnLook,
  settleReturningSnoozedTabs
} from '@/lib/tab-snooze/snooze-return'

/**
 * Keeps this window's copy of main's snoozed-tab list, takes back the tabs
 * whose time has come, and finishes returns once their terminal has started.
 * Mounted once at App level.
 */
export function useTabSnooze(): void {
  const workspaceSessionReady = useAppStore((state) => state.workspaceSessionReady)

  useEffect(() => {
    const api = window.api.tabSnooze
    if (!api) {
      return undefined
    }
    let alive = true
    const look = createSerialLook(() =>
      runSnoozeReturnLook({
        getState: () => useAppStore.getState(),
        bringBack: (ref, options) => bringBackSnoozedTab(ref, options)
      })
    )
    const refresh = async (): Promise<void> => {
      try {
        const entries = await api.list()
        if (alive) {
          useAppStore.getState().setSnoozedTabs(entries)
          look()
        }
      } catch (err) {
        console.warn('[tab-snooze] could not read the snoozed tabs:', err)
      }
    }
    void refresh()
    const offChanged = api.onChanged(() => void refresh())
    // Why a store subscription: "the tab's terminal started" and "the tab was
    // closed" are both plain store changes, with no event of their own.
    const offStore = useAppStore.subscribe((state, previous) => {
      if (
        Object.keys(state.returningSnoozedTabs).length > 0 &&
        (state.tabsByWorktree !== previous.tabsByWorktree ||
          state.ptyIdsByTabId !== previous.ptyIdsByTabId ||
          state.returningSnoozedTabs !== previous.returningSnoozedTabs)
      ) {
        settleReturningSnoozedTabs({
          getState: () => useAppStore.getState(),
          api,
          releaseAgentResume: (token, owner) => window.api.pty.releaseAgentResume(token, owner)
        })
      }
      if (state.pendingSnoozeBringBacks !== previous.pendingSnoozeBringBacks) {
        look()
      }
    })
    return () => {
      alive = false
      offChanged()
      offStore()
    }
    // Why re-run on ready: the first look happens before this window's tabs
    // are restored and does nothing; this one takes what was waiting.
  }, [workspaceSessionReady])

  useEffect(() => {
    let alive = true
    window.api.ui
      .get()
      .then((ui) => {
        if (alive) {
          useAppStore
            .getState()
            .setSnoozedShelfOpenWorktreeIds(ui.snoozedShelfOpenWorktreeIds ?? [])
        }
      })
      .catch(console.error)
    return () => {
      alive = false
    }
  }, [])
}
