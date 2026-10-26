// Types the handoff / verify instructions into the connected console through
// the Board delivery queue (waits on dialogs, never interleaves with other sends).
// The handoff waits for an idle console: it must not land mid-task.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { consoleDeliveryState, deliverOrder } from '../board-delivery/board-delivery'
import { browserHandoffText, browserVerifyText, driverConsoleOf } from './browser-link'

async function deliverToDriver(
  worktreeId: string,
  tile: BoardCardOf<'web'>,
  text: (tile: BoardCardOf<'web'>, driver: BoardCardOf<'console'>) => string,
  summary: string
): Promise<boolean> {
  const driver = driverConsoleOf(getBoard(useAppStore.getState(), worktreeId).cards, tile)
  if (!driver) {
    return false
  }
  const result = await deliverOrder({
    worktreeId,
    summary,
    lanes: [{ tabId: driver.tabId, name: driver.title, text: text(tile, driver) }]
  })
  if (!result.ok) {
    toast.error(result.text)
  }
  return result.ok
}

function handoffSummary(tile: BoardCardOf<'web'>): string {
  return translate('board.browserLink.handoffSummary', 'Browser handoff: {{title}}', {
    title: tile.title
  })
}

/** The link is still this console → this tile (not disconnected or re-pointed meanwhile). */
function linkStillHolds(worktreeId: string, tileId: string, driverCardId: string): boolean {
  const tile = getBoard(useAppStore.getState(), worktreeId).cards.find((c) => c.id === tileId)
  return tile?.kind === 'web' && tile.driverCardId === driverCardId
}

/**
 * Delivers the handoff once the console is idle. Returns true when it was sent
 * now, false when it is waiting on the console (a store subscription fires it;
 * the wait ends if the link is removed first).
 */
export function deliverHandoffWhenIdle(
  worktreeId: string,
  tile: BoardCardOf<'web'>,
  driver: BoardCardOf<'console'>
): boolean {
  const send = (): void => {
    void deliverToDriver(worktreeId, tile, browserHandoffText, handoffSummary(tile))
  }
  if (consoleDeliveryState(driver.tabId) !== 'working') {
    send()
    return true
  }
  // Why: the gate would queue it behind the current turn, but the agent's own
  // terminal types queued text into the running task; wait for idle instead.
  const unsubscribe = useAppStore.subscribe(() => {
    if (!linkStillHolds(worktreeId, tile.id, driver.id)) {
      unsubscribe()
      return
    }
    if (consoleDeliveryState(driver.tabId) !== 'working') {
      unsubscribe()
      send()
    }
  })
  return false
}

/** Connects `driverCardId` to the tile and hands the console its page id, agent id and rules. */
export function connectBrowserLink(
  worktreeId: string,
  tile: BoardCardOf<'web'>,
  driverCardId: string
): void {
  const state = useAppStore.getState()
  const driver = getBoard(state, worktreeId).cards.find((c) => c.id === driverCardId)
  if (driver?.kind !== 'console') {
    return
  }
  state.updateCard(worktreeId, tile.id, { driverCardId })
  const linked = { ...tile, driverCardId }
  if (!deliverHandoffWhenIdle(worktreeId, linked, driver)) {
    toast.info(
      translate(
        'board.browserLink.handoffDeferred',
        '{{name}} is working. The browser handoff is sent when it is idle.',
        { name: driver.title }
      )
    )
  }
}

export function disconnectBrowserLink(worktreeId: string, tileId: string): void {
  const state = useAppStore.getState()
  const tile = getBoard(state, worktreeId).cards.find((c) => c.id === tileId)
  if (tile?.kind === 'web' && tile.driverCardId) {
    state.updateCard(worktreeId, tileId, { driverCardId: undefined })
  }
}

/** Asks the connected console to walk its last change in the tile and report. */
export function verifyInBrowser(worktreeId: string, tile: BoardCardOf<'web'>): Promise<boolean> {
  return deliverToDriver(
    worktreeId,
    tile,
    browserVerifyText,
    translate('board.browserLink.verifySummary', 'Verify in browser: {{title}}', {
      title: tile.title
    })
  )
}
