// `dobius board open-tile`: an agent asks main to put a web tile card on a
// worktree's Board. Main validates (http(s) only), hands the request to the
// renderer (window IPC `ui:boardOpenWebTile` plus the `boardOpenWebTile` client
// event), waits for the tile's guest to register, and returns the handles the
// browser CLI needs (`--page web-tile:<cardId>`).
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AgentIdSchema } from '../../../../shared/agent-cursor'
import { webTileBrowserPageId } from '../../../../shared/board-web-tile-popup'
import type { RuntimeBoardOpenWebTileEvent } from '../../../../shared/runtime-client-events'
import { waitForTabRegistration } from '../../../ipc/browser'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { defineMethod, type RpcMethod } from '../core'

const MAX_TITLE_CHARS = 200
const MAX_URL_CHARS = 8_000
export const WEB_TILE_GUEST_TIMEOUT_MS = 15_000

const WorktreeSelector = z
  .unknown()
  .transform((v) => (typeof v === 'string' ? v : ''))
  .pipe(z.string().min(1, 'Missing worktree selector'))

export const HttpUrl = z
  .string()
  .trim()
  .min(1, 'Missing url')
  .max(MAX_URL_CHARS, 'url is too long')
  .transform((value, ctx) => {
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', message: 'url must be http(s)' })
        return z.NEVER
      }
      return parsed.toString()
    } catch {
      ctx.addIssue({ code: 'custom', message: 'url is not a valid URL' })
      return z.NEVER
    }
  })

export const OpenWebTileParams = z
  .object({
    worktree: WorktreeSelector,
    url: HttpUrl,
    title: z
      .string()
      .max(MAX_TITLE_CHARS, 'title is too long')
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
    agentId: AgentIdSchema.optional()
  })
  .strict()

export type OpenWebTileInput = z.input<typeof OpenWebTileParams>
export type OpenWebTileResult = {
  requestId: string
  worktreeId: string
  cardId: string
  browserPageId: string
}

export type OpenWebTileDeps = {
  waitForGuest: (browserPageId: string, timeoutMs: number) => Promise<void>
}

const defaultDeps: OpenWebTileDeps = { waitForGuest: waitForTabRegistration }

export async function openBoardWebTile(
  runtime: DobiusRuntimeService,
  input: OpenWebTileInput,
  deps: OpenWebTileDeps = defaultDeps
): Promise<OpenWebTileResult> {
  const params = OpenWebTileParams.parse(input)
  const worktree = await runtime.showManagedWorktree(params.worktree)
  const requestId = randomUUID()
  const event: RuntimeBoardOpenWebTileEvent = {
    type: 'boardOpenWebTile',
    requestId,
    worktreeId: worktree.id,
    url: params.url,
    ...(params.title ? { title: params.title } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {})
  }
  const { cardId } = await runtime.notifyBoardOpenWebTile(event)
  if (!cardId) {
    throw new Error('no_window: open the Dobius+ window to add a web tile')
  }
  const browserPageId = webTileBrowserPageId(cardId)
  await deps.waitForGuest(browserPageId, WEB_TILE_GUEST_TIMEOUT_MS)
  return { requestId, worktreeId: worktree.id, cardId, browserPageId }
}

export const BOARD_WEB_TILE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'board.openWebTile',
    params: OpenWebTileParams,
    handler: (params, { runtime }) => openBoardWebTile(runtime, params)
  })
]
