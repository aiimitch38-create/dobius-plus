// Header controls for the console ↔ web tile driver link: Connect terminal /
// Verify / Disconnect on the tile, Connect browser on the console title bar.
import React from 'react'
import { Cable, Check, SearchCheck, Unplug } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { useBoardLinkMode } from '../board-links/board-link-mode'
import {
  useConsoleCardStatus,
  type ConsoleCardLiveStatus
} from '../console-card/use-console-card-status'
import type { ConsoleCardStatus } from '../console-card/console-card-status'
import { driverConsoleOf, tilesDrivenBy } from './browser-link'
import { disconnectBrowserLink, verifyInBrowser } from './browser-link-delivery'

const NAV_BUTTON =
  'flex size-7 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] disabled:opacity-40'

function useConnecting(sourceCardId: string): boolean {
  return useBoardLinkMode((s) => s.mode?.kind === 'browser' && s.mode.sourceCardId === sourceCardId)
}

function toggleConnect(
  worktreeId: string,
  sourceCardId: string,
  sourceKind: 'web' | 'console',
  connecting: boolean
): void {
  if (connecting) {
    useBoardLinkMode.getState().stop()
  } else {
    useBoardLinkMode.getState().start({ kind: 'browser', worktreeId, sourceCardId, sourceKind })
  }
}

/** Why Verify is unavailable for a console in `status`; null when it can take the prompt now. */
export function verifyBlockedReason(status: ConsoleCardStatus, name: string): string | null {
  switch (status) {
    case 'idle':
      return null
    case 'working':
      return translate(
        'board.browserLink.busyWorking',
        '{{name}} is working. Verify when it is idle.',
        {
          name
        }
      )
    case 'waiting':
      return translate('board.browserLink.busyWaiting', '{{name}} needs you first.', { name })
    case 'paused':
      return translate('board.browserLink.busyPaused', '{{name}} is paused.', { name })
    case 'shell':
    case 'done':
    case 'gone':
      return translate('board.browserLink.busyGone', '{{name}} is not running an agent.', { name })
  }
}

function VerifyButton({
  worktreeId,
  tile,
  driver
}: {
  worktreeId: string
  tile: BoardCardOf<'web'>
  driver: BoardCardOf<'console'>
}): React.JSX.Element {
  const { status }: ConsoleCardLiveStatus = useConsoleCardStatus(worktreeId, driver.tabId)
  const blocked = verifyBlockedReason(status, driver.title)
  const label = translate('board.browserLink.verify', 'Verify with {{name}}', {
    name: driver.title
  })
  return (
    <button
      type="button"
      aria-label={label}
      title={blocked ?? label}
      disabled={blocked !== null}
      onClick={() => void verifyInBrowser(worktreeId, tile)}
      className={`${NAV_BUTTON} text-[var(--board-accent)]`}
    >
      <SearchCheck className="size-4" />
    </button>
  )
}

/** Tile header: Connect terminal when unlinked; Verify + Disconnect once a console drives it. */
export function WebTileLinkControls({
  worktreeId,
  tile
}: {
  worktreeId: string
  tile: BoardCardOf<'web'>
}): React.JSX.Element {
  const connecting = useConnecting(tile.id)
  const driver = useAppStore((s) => driverConsoleOf(getBoard(s, worktreeId).cards, tile))
  if (driver) {
    const disconnect = translate('board.browserLink.disconnect', 'Disconnect {{name}}', {
      name: driver.title
    })
    return (
      <>
        <VerifyButton worktreeId={worktreeId} tile={tile} driver={driver} />
        <button
          type="button"
          aria-label={disconnect}
          title={disconnect}
          onClick={() => disconnectBrowserLink(worktreeId, tile.id)}
          className={NAV_BUTTON}
        >
          <Unplug className="size-4" />
        </button>
      </>
    )
  }
  const label = connecting
    ? translate('board.browserLink.pickConsole', 'Click a console to connect it, or press Esc')
    : translate('board.browserLink.connectTerminal', 'Connect a terminal to drive this tile')
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={connecting}
      title={label}
      onClick={() => toggleConnect(worktreeId, tile.id, 'web', connecting)}
      className={`${NAV_BUTTON} aria-pressed:bg-[var(--board-accent)] aria-pressed:text-[var(--board-accent-fg)]`}
    >
      {connecting ? <Check className="size-4" /> : <Cable className="size-4" />}
    </button>
  )
}

/** Console title bar: start picking a web tile for this console to drive. */
export function ConsoleBrowserLinkButton({
  worktreeId,
  card
}: {
  worktreeId: string
  card: BoardCardOf<'console'>
}): React.JSX.Element {
  const connecting = useConnecting(card.id)
  const driven = useAppStore((s) => tilesDrivenBy(getBoard(s, worktreeId).cards, card.id).length)
  const label = connecting
    ? translate('board.browserLink.pickTile', 'Click a web tile to connect it, or press Esc')
    : driven > 0
      ? translate(
          'board.browserLink.connectedTiles',
          'Driving {{count}} web tile(s) · click to change',
          {
            count: driven
          }
        )
      : translate(
          'board.browserLink.connectBrowser',
          'Connect a browser tile for this console to drive'
        )
  return (
    <button
      type="button"
      data-board-card-control
      aria-label={label}
      aria-pressed={connecting}
      title={label}
      onClick={() => toggleConnect(worktreeId, card.id, 'console', connecting)}
      className={`flex size-6 items-center justify-center rounded-full hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)] aria-pressed:bg-[var(--board-accent)] aria-pressed:text-[var(--board-accent-fg)] ${
        driven > 0 ? 'text-[var(--board-accent)]' : 'text-[var(--board-text-muted)]'
      }`}
    >
      {connecting ? <Check className="size-3.5" /> : <Cable className="size-3.5" />}
    </button>
  )
}
