import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { safeText } from '../safe-text'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'

type SnapshotMeta = {
  id: string
  worktreeId: string
  takenAt: number
  reason: string
  archived: boolean
  cards: number
  consoles: number
}
type SnapshotList = { worktreeId: string; snapshots: SnapshotMeta[]; totalCount: number; truncated: boolean }
type SnapshotFile = { worktreeId: string; takenAt: number; reason: string; board: unknown }
type CaptureResult = { worktreeId: string; captured: boolean; reason?: string }

export function formatSnapshotList(list: SnapshotList): string {
  if (list.snapshots.length === 0) {
    return 'No saved snapshots for this board.'
  }
  const lines = list.snapshots.map((s) =>
    safeText(
      `${s.id}  ${new Date(s.takenAt).toISOString()}  ${s.reason}${s.archived ? ` (archived from ${s.worktreeId})` : ''}  ${s.cards} cards, ${s.consoles} consoles`
    )
  )
  if (list.truncated) {
    lines.push(`(showing ${list.snapshots.length} of ${list.totalCount})`)
  }
  return lines.join('\n')
}

async function worktreeOf({ flags, cwd, client }: HandlerContext): Promise<string> {
  return (
    (await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)) ??
    (await resolveCurrentWorktreeSelector(cwd, client))
  )
}

export const BOARD_SNAPSHOT_HANDLERS: Record<string, CommandHandler> = {
  'board snapshots list': async (ctx) => {
    const result = await ctx.client.call<SnapshotList>('board.snapshotList', {
      worktree: await worktreeOf(ctx)
    })
    printResult(result, ctx.json, formatSnapshotList)
  },
  'board snapshots read': async (ctx) => {
    const id = getRequiredStringFlag(ctx.flags, 'id')
    const source = getOptionalStringFlag(ctx.flags, 'source')
    const result = await ctx.client.call<SnapshotFile>('board.snapshotRead', {
      worktree: await worktreeOf(ctx),
      id,
      ...(source ? { source } : {})
    })
    printResult(result, ctx.json, (file) =>
      safeText(
        `Snapshot of ${file.worktreeId}, ${new Date(file.takenAt).toISOString()} (${file.reason}):\n${JSON.stringify(file.board, null, 2)}`
      )
    )
  },
  'board snapshots capture': async (ctx) => {
    const result = await ctx.client.call<CaptureResult>('board.snapshotCapture', {
      worktree: await worktreeOf(ctx)
    })
    printResult(result, ctx.json, (value) =>
      value.captured ? `Saved a snapshot of the Board for ${value.worktreeId}.` : (value.reason ?? 'Nothing saved.')
    )
  }
}
