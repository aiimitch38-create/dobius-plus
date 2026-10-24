import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { translate } from '@/i18n/i18n'
import type {
  BoardSnapshotMeta,
  BoardSnapshotReason
} from '../../../../../shared/board-snapshot-types'
import {
  closeBoardSnapshotRestore,
  restoreBoardSnapshot,
  snapshotRestoreWorktree,
  subscribeSnapshotRestore
} from './board-snapshot-restore'

function reasonLabel(reason: BoardSnapshotReason): string {
  switch (reason) {
    case 'hourly':
      return translate('board.snapshots.reason.hourly', 'Hourly')
    case 'quit':
      return translate('board.snapshots.reason.quit', 'On quit')
    case 'close':
      return translate('board.snapshots.reason.close', 'Left the Board')
    case 'manual':
      return translate('board.snapshots.reason.manual', 'Before a restore')
    case 'closed-board':
      return translate('board.snapshots.reason.closedBoard', 'Closed board (archived)')
  }
}

export function BoardSnapshotRestoreDialog(): React.JSX.Element {
  const worktreeId = useSyncExternalStore(subscribeSnapshotRestore, snapshotRestoreWorktree)
  const [snapshots, setSnapshots] = useState<BoardSnapshotMeta[] | null>(null)
  const [picked, setPicked] = useState<BoardSnapshotMeta | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPicked(null)
    setSnapshots(null)
    if (!worktreeId) {
      return
    }
    let live = true
    window.api.boardSnapshots
      .list({ worktreeId })
      .then((list) => live && setSnapshots(list))
      .catch((error: unknown) => {
        console.warn('[board-snapshots] list failed', error)
        if (live) {
          setSnapshots([])
        }
      })
    return () => {
      live = false
    }
  }, [worktreeId])

  const restore = async (): Promise<void> => {
    if (!worktreeId || !picked) {
      return
    }
    setBusy(true)
    try {
      const ok = await restoreBoardSnapshot(worktreeId, picked)
      if (ok) {
        toast.success(translate('board.snapshots.restored', 'Snapshot restored.'))
        closeBoardSnapshotRestore()
      } else {
        toast.error(translate('board.snapshots.unreadable', 'That snapshot could not be read.'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={worktreeId !== null}
      onOpenChange={(open) => !open && closeBoardSnapshotRestore()}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {picked
              ? translate('board.snapshots.confirmTitle', 'Restore this snapshot?')
              : translate('board.snapshots.title', 'Restore a snapshot')}
          </DialogTitle>
          <DialogDescription>
            {picked
              ? translate(
                  'board.snapshots.confirmBody',
                  'Cards, groups and arrows come back as saved. Running terminals are never closed; a console whose terminal is gone shows as closed. The current board is saved as a snapshot first, and Undo also reverts it.'
                )
              : translate(
                  'board.snapshots.body',
                  'The Board saves itself every hour (last 24 kept), when you leave it and when Dobius quits. Boards of removed workspaces stay in the archive.'
                )}
          </DialogDescription>
        </DialogHeader>
        {picked ? null : (
          <ScrollArea className="max-h-[360px]">
            {snapshots === null ? (
              <p className="p-2 text-sm text-muted-foreground">
                {translate('board.snapshots.loading', 'Loading snapshots…')}
              </p>
            ) : snapshots.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">
                {translate('board.snapshots.none', 'No snapshots yet.')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {snapshots.map((s) => (
                  <li key={`${s.worktreeId}:${s.id}`}>
                    <button
                      type="button"
                      onClick={() => setPicked(s)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium">{new Date(s.takenAt).toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground">
                          {reasonLabel(s.reason)}
                          {s.worktreeId !== worktreeId
                            ? ` · ${translate('board.snapshots.otherWorkspace', 'another workspace')}`
                            : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {translate(
                          'board.snapshots.counts',
                          '{{cards}} cards · {{consoles}} consoles',
                          { cards: s.cards, consoles: s.consoles }
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
        <DialogFooter>
          {picked ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPicked(null)}>
                {translate('board.snapshots.back', 'Back')}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void restore()}>
                {translate('board.snapshots.restore', 'Restore')}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={closeBoardSnapshotRestore}>
              {translate('board.snapshots.close', 'Close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
