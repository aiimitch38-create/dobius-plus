import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActiveBoardSnapshotService } from '../../../board-snapshots/board-snapshot-active'
import { worktreeFolderName } from '../../../board-snapshots/board-snapshot-rules'
import { BoardSnapshotService } from '../../../board-snapshots/board-snapshot-service'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { BOARD_SNAPSHOT_METHODS } from './board-snapshots'

const WT = 'wt-1'
const board = (n: number) => ({
  cards: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: i === 0 ? 'console' : 'note' })),
  groups: []
})

describe('board snapshot RPC methods', () => {
  let root: string
  let clock: number
  let service: BoardSnapshotService
  let boards: Record<string, unknown>
  let call: (method: string, params: unknown) => Promise<RpcResponse>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'board-snapshot-rpc-'))
    clock = 1_700_000_000_000
    service = new BoardSnapshotService(root, () => clock)
    setActiveBoardSnapshotService(service)
    boards = { [WT]: board(2) }
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      showManagedWorktree: vi.fn(async () => ({ id: WT, path: '/repo/wt-1' })),
      getUIState: () => ({ boardsByWorktree: boards })
    } as unknown as DobiusRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: BOARD_SNAPSHOT_METHODS })
    call = async (method, params) =>
      (await dispatcher.dispatch({ id: 'r', authToken: 't', method, params } as RpcRequest)) as RpcResponse
  })
  afterEach(() => {
    setActiveBoardSnapshotService(null)
    rmSync(root, { recursive: true, force: true })
  })

  it('captures once, then refuses an unchanged board so repeated calls cannot prune history', async () => {
    const first = await call('board.snapshotCapture', { worktree: `id:${WT}` })
    expect(first).toMatchObject({ ok: true, result: { captured: true } })
    clock += 1000
    const again = await call('board.snapshotCapture', { worktree: `id:${WT}` })
    expect(again).toMatchObject({ ok: true, result: { captured: false } })
    expect(readdirSync(join(root, worktreeFolderName(WT)))).toHaveLength(1)
  })

  it('lists and reads a snapshot; an unknown id is board_snapshot_not_found', async () => {
    await call('board.snapshotCapture', { worktree: `id:${WT}` })
    const list = await call('board.snapshotList', { worktree: `id:${WT}` })
    const [meta] = (list as { result: { snapshots: { id: string; cards: number }[] } }).result.snapshots
    expect(meta.cards).toBe(2)
    const read = await call('board.snapshotRead', { worktree: `id:${WT}`, id: meta.id })
    expect(read).toMatchObject({ ok: true, result: { worktreeId: WT, reason: 'manual' } })
    const missing = await call('board.snapshotRead', { worktree: `id:${WT}`, id: '1-manual.json' })
    expect(missing).toMatchObject({ ok: false, error: { code: 'board_snapshot_not_found' } })
    const traversal = await call('board.snapshotRead', { worktree: `id:${WT}`, id: '../x.json' })
    expect(traversal).toMatchObject({ ok: false, error: { code: 'board_snapshot_not_found' } })
  })

  it('reads an archived board only through a listed --source', async () => {
    service.archiveRemoved({ gone: board(3) }, {})
    const list = await call('board.snapshotList', { worktree: `id:${WT}` })
    const archived = (list as { result: { snapshots: { id: string; worktreeId: string; archived: boolean }[] } }).result.snapshots.find(
      (s) => s.archived
    )
    expect(archived?.worktreeId).toBe('gone')
    const read = await call('board.snapshotRead', { worktree: `id:${WT}`, id: archived!.id, source: 'gone' })
    expect(read).toMatchObject({ ok: true, result: { worktreeId: 'gone', reason: 'closed-board' } })
    const unlisted = await call('board.snapshotRead', { worktree: `id:${WT}`, id: archived!.id, source: 'other' })
    expect(unlisted).toMatchObject({ ok: false, error: { code: 'board_snapshot_not_found' } })
  })

  it('says snapshots are unavailable when the service is not running', async () => {
    setActiveBoardSnapshotService(null)
    const r = await call('board.snapshotList', { worktree: `id:${WT}` })
    expect(r).toMatchObject({ ok: false, error: { code: 'board_snapshot_unavailable' } })
  })
})
