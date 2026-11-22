import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { safeText } from '../safe-text'
import {
  BOARD_CARD_ADDRESS_PREFIX,
  getOptionalWorktreeSelector,
  resolveCurrentWorktreeSelector
} from '../selectors'

type BoardCardRow = {
  id: string
  kind: string
  title: string
  preview?: string | null
  status?: string | null
  handle?: string | null
}
type BoardCardList = { worktreeId: string; cards: BoardCardRow[]; totalCount: number; truncated: boolean }
type CardActionResult = { cardId: string; action: string; message: string; worktreeId: string }

export function formatBoardCards(list: BoardCardList): string {
  if (list.cards.length === 0) {
    return 'No cards on this board.'
  }
  const lines = list.cards.map((c) => {
    const label = c.title || c.preview || ''
    return safeText(`${c.id}  ${c.kind}  ${c.status ?? '-'}  ${c.handle ?? '-'}  ${label}`)
  })
  if (list.truncated) {
    lines.push(`(showing ${list.cards.length} of ${list.totalCount} cards)`)
  }
  return lines.join('\n')
}

async function worktreeOf({ flags, cwd, client }: HandlerContext): Promise<string> {
  return (
    (await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)) ??
    (await resolveCurrentWorktreeSelector(cwd, client))
  )
}

function cardFlag(flags: Map<string, string | boolean>, required: true): string
function cardFlag(flags: Map<string, string | boolean>, required: false): string | undefined
function cardFlag(flags: Map<string, string | boolean>, required: boolean): string | undefined {
  const raw = required ? getRequiredStringFlag(flags, 'card') : getOptionalStringFlag(flags, 'card')
  // Why: `card:<id>` is the address form used elsewhere; accept it here too.
  return raw?.startsWith(BOARD_CARD_ADDRESS_PREFIX) ? raw.slice(BOARD_CARD_ADDRESS_PREFIX.length) : raw
}

async function cardAction(ctx: HandlerContext, params: Record<string, unknown>): Promise<void> {
  const result = await ctx.client.call<CardActionResult>('board.cardAction', {
    worktree: await worktreeOf(ctx),
    ...params
  })
  printResult(result, ctx.json, (value) => safeText(value.message))
}

export const BOARD_CARD_HANDLERS: Record<string, CommandHandler> = {
  'board list': async (ctx) => {
    const result = await ctx.client.call<BoardCardList>('board.listCards', {
      worktree: await worktreeOf(ctx)
    })
    printResult(result, ctx.json, formatBoardCards)
  },
  'board restart': async (ctx) =>
    cardAction(ctx, {
      action: 'restart',
      card: cardFlag(ctx.flags, true),
      ...(ctx.flags.get('force') === true ? { force: true } : {})
    }),
  'board rename': async (ctx) =>
    cardAction(ctx, {
      action: 'rename',
      card: cardFlag(ctx.flags, true),
      title: getRequiredStringFlag(ctx.flags, 'title')
    }),
  'board note': async (ctx) => {
    const card = cardFlag(ctx.flags, false)
    return cardAction(ctx, {
      action: 'note',
      text: getRequiredStringFlag(ctx.flags, 'text'),
      ...(card ? { card } : {})
    })
  },
  'board close': async (ctx) =>
    cardAction(ctx, {
      action: 'close',
      card: cardFlag(ctx.flags, true),
      ...(ctx.flags.get('force') === true ? { force: true } : {})
    })
}
