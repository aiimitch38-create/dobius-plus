import { useEffect } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { screenToWorld } from '../board-canvas/board-viewport'
import { boardShowsOrigin, devServerUrlForPort } from './dev-server-url'

const TILE = { w: 900, h: 600 }

/**
 * Mount once with the Board. When a console in this worktree prints a dev-server
 * URL (main's advertised-URL watcher), opens it as a web tile unless one already shows it.
 */
// ponytail: local port scan only; SSH workspaces need their ports forwarded first.
export function BoardDevServerWatcher({ worktreeId }: { worktreeId: string }): null {
  useEffect(
    () =>
      window.api.workspacePorts.onAdvertisedUrlChanged((event) => {
        if (event.worktreeId !== worktreeId) {
          return
        }
        const repoId = findWorktreeById(useAppStore.getState().worktreesByRepo, worktreeId)?.repoId
        void window.api.workspacePorts
          .scan({ repoId })
          .then((result) => {
            const url = devServerUrlForPort(result.ports, worktreeId, event.port)
            const state = useAppStore.getState()
            const board = getBoard(state, worktreeId)
            if (!url || boardShowsOrigin(board, url)) {
              return
            }
            const center = screenToWorld(
              { x: window.innerWidth / 2, y: window.innerHeight / 2 },
              board.viewport
            )
            const id = state.addCard(worktreeId, {
              kind: 'web',
              url,
              title: translate('board.web.preview', 'Preview · {{port}}', { port: event.port }),
              x: center.x - TILE.w / 2,
              y: center.y - TILE.h / 2,
              ...TILE
            })
            state.bringToFront(worktreeId, [id])
          })
          .catch((error: unknown) => console.debug('[board-web] port scan failed', error))
      }),
    [worktreeId]
  )
  return null
}
