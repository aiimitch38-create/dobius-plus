import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  BoardSnapshotFile,
  BoardSnapshotMeta,
  BoardSnapshotReason
} from '../../shared/board-snapshot-types'
import {
  boardContentKey,
  isSnapshotWorthy,
  removedBoardIds,
  snapshotFileName,
  snapshotMeta,
  snapshotsToPrune,
  worktreeFolderName
} from './board-snapshot-rules'

// Writes, lists and reads Board snapshots under <root>/<hashed worktree>/.
// Sync I/O on purpose: the quit snapshot runs inside before-quit, and boards are
// small JSON documents.

const ARCHIVE = 'archive'
const SNAPSHOT_ID = /^(archive\/)?\d{10,16}-[a-z-]+\.json$/

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function readSnapshot(path: string): BoardSnapshotFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return isObj(parsed) && typeof parsed.worktreeId === 'string'
      ? (parsed as BoardSnapshotFile)
      : null
  } catch {
    // Why: a half-written or hand-edited file is skipped, never fatal to the list.
    return null
  }
}

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
}

export class BoardSnapshotService {
  /** Content key of the newest autosave per worktree, so unchanged boards are not saved twice. */
  private readonly lastKeys = new Map<string, string>()

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now
  ) {}

  private folder(worktreeId: string): string {
    return join(this.root, worktreeFolderName(worktreeId))
  }

  private write(dir: string, file: BoardSnapshotFile): string {
    mkdirSync(dir, { recursive: true })
    const name = snapshotFileName(file.takenAt, file.reason)
    const target = join(dir, name)
    const temp = `${target}.tmp`
    writeFileSync(temp, JSON.stringify(file))
    renameSync(temp, target)
    return name
  }

  private latestKey(worktreeId: string): string | undefined {
    const cached = this.lastKeys.get(worktreeId)
    if (cached !== undefined) {
      return cached
    }
    const dir = this.folder(worktreeId)
    const newest = listJson(dir).sort().at(-1)
    const snapshot = newest ? readSnapshot(join(dir, newest)) : null
    const key = snapshot ? boardContentKey(snapshot.board) : undefined
    if (key !== undefined) {
      this.lastKeys.set(worktreeId, key)
    }
    return key
  }

  /** Autosaves one board unless it is empty or unchanged since the last autosave. */
  capture(worktreeId: string, board: unknown, reason: BoardSnapshotReason): boolean {
    if (!isSnapshotWorthy(board)) {
      return false
    }
    const key = boardContentKey(board)
    if (reason !== 'manual' && this.latestKey(worktreeId) === key) {
      return false
    }
    const dir = this.folder(worktreeId)
    this.write(dir, { version: 1, worktreeId, takenAt: this.now(), reason, board })
    this.lastKeys.set(worktreeId, key)
    for (const name of snapshotsToPrune(listJson(dir))) {
      rmSync(join(dir, name), { force: true })
    }
    return true
  }

  captureAll(boardsByWorktree: unknown, reason: BoardSnapshotReason): number {
    if (!isObj(boardsByWorktree)) {
      return 0
    }
    let saved = 0
    for (const [worktreeId, board] of Object.entries(boardsByWorktree)) {
      try {
        if (this.capture(worktreeId, board, reason)) {
          saved += 1
        }
      } catch (error) {
        console.warn('[board-snapshots] could not save a snapshot', error)
      }
    }
    return saved
  }

  /** Boards that vanished from the persisted map (workspace removed) go to the never-pruned archive. */
  archiveRemoved(previous: unknown, next: unknown): number {
    let archived = 0
    for (const worktreeId of removedBoardIds(previous, next)) {
      const board = isObj(previous) ? previous[worktreeId] : undefined
      if (!isSnapshotWorthy(board)) {
        continue
      }
      try {
        this.write(join(this.folder(worktreeId), ARCHIVE), {
          version: 1,
          worktreeId,
          takenAt: this.now(),
          reason: 'closed-board',
          board
        })
        archived += 1
      } catch (error) {
        console.warn('[board-snapshots] could not archive a closed board', error)
      }
    }
    return archived
  }

  /** This worktree's snapshots plus every archived (closed) board, newest first. */
  list(worktreeId: string): BoardSnapshotMeta[] {
    const out: BoardSnapshotMeta[] = []
    const ownFolder = worktreeFolderName(worktreeId)
    for (const folder of listFolders(this.root)) {
      const dir = join(this.root, folder)
      const sources: { names: string[]; base: string; archived: boolean }[] = [
        { names: listJson(join(dir, ARCHIVE)), base: join(dir, ARCHIVE), archived: true }
      ]
      if (folder === ownFolder) {
        sources.push({ names: listJson(dir), base: dir, archived: false })
      }
      for (const { names, base, archived } of sources) {
        for (const name of names) {
          const snapshot = readSnapshot(join(base, name))
          const meta = snapshot && snapshotMeta(snapshot.worktreeId, name, snapshot.board, archived)
          if (meta) {
            out.push(meta)
          }
        }
      }
    }
    return out.sort((a, b) => b.takenAt - a.takenAt)
  }

  read(worktreeId: string, id: string): BoardSnapshotFile | null {
    if (!SNAPSHOT_ID.test(id)) {
      return null
    }
    return readSnapshot(join(this.folder(worktreeId), ...id.split('/')))
  }
}

function listFolders(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}
