import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  existsSync,
  mkdtempSync,
  promises as fsPromises,
  readdirSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { DaemonServer } from './daemon-server'
import type { HistoryManager } from './history-manager'
import { getHistorySessionDirName } from './history-paths'
import type { SubprocessHandle } from './session'
import type { PendingOutputRecord, TerminalSnapshot } from './types'

const snapshot: TerminalSnapshot = {
  snapshotAnsi: 'OLD-SESSION-SNAPSHOT\r\n',
  scrollbackAnsi: '',
  rehydrateSequences: '',
  cwd: '/tmp',
  modes: {
    bracketedPaste: false,
    mouseTracking: false,
    applicationCursor: false,
    alternateScreen: false
  },
  cols: 80,
  rows: 24,
  scrollbackLines: 0
}

const oldRecords: PendingOutputRecord[] = [{ kind: 'output', data: 'OLD-SESSION-OUTPUT' }]

// Why: the exit handler awaits the final checkpoint's tmp write. If the same
// ptyId is respawned during that await, nothing of the old session (snapshot,
// records, endedAt) may land in the new live session's history.
describe('DaemonServer history close vs respawn race', () => {
  let dir: string
  let server: DaemonServer

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-close-race-'))
    server = new DaemonServer({
      socketPath: join(dir, 'sock'),
      tokenPath: join(dir, 'token'),
      historyPath: join(dir, 'terminal-history'),
      spawnSubprocess: () => ({}) as SubprocessHandle
    })
  })

  afterEach(() => {
    server['stopCheckpointTimer']()
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  function history(): HistoryManager {
    const manager = server['historyManager']
    if (!manager) {
      throw new Error('history manager missing')
    }
    return manager
  }

  function sessionDir(): string {
    return join(dir, 'terminal-history', getHistorySessionDirName('pty-1'))
  }

  function readIfExists(name: string): string {
    const file = join(sessionDir(), name)
    return existsSync(file) ? readFileSync(file, 'utf-8') : ''
  }

  // Blocks the checkpoint tmp write until the returned release() is called.
  function blockCheckpointTmpWrite(): { started: Promise<void>; release: () => void } {
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered: () => void = () => undefined
    const tmpWriteStarted = new Promise<void>((resolve) => {
      entered = resolve
    })
    const realWriteFile = fsPromises.writeFile.bind(fsPromises)
    vi.spyOn(fsPromises, 'writeFile').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('checkpoint.json.tmp')) {
        entered()
        await barrier
      }
      return realWriteFile(...args)
    })
    return { started: tmpWriteStarted, release }
  }

  // Exit pty-1 with a final snapshot + records; optionally respawn it while the
  // checkpoint's tmp write is blocked.
  async function exitWithBarrier(respawn: (() => Promise<void>) | null): Promise<void> {
    await server['trackHistorySession']('pty-1', { isNew: true, cwd: '/tmp', cols: 80, rows: 24 })
    const gate = blockCheckpointTmpWrite()
    const closing = server['closeHistorySession']('pty-1', 0, snapshot, 1, oldRecords)
    await gate.started
    await respawn?.()
    gate.release()
    await closing
  }

  function expectUntouchedLiveSession(): void {
    expect(history().readMeta('pty-1')?.endedAt).toBeNull()
    expect(history()['writers'].has('pty-1')).toBe(true)
    expect(readdirSync(sessionDir()).sort()).toEqual(['meta.json'])
    expect(readIfExists('output.log')).not.toContain('OLD-SESSION-OUTPUT')
  }

  it('production respawn (createOrAttach isNew → registerWriter) keeps the new session live', async () => {
    await exitWithBarrier(async () => {
      // meta endedAt is still null here, so this takes the registerWriter branch.
      expect(server['historyReader']?.hasRestorableHistory('pty-1')).toBe(true)
      await server['trackHistorySession']('pty-1', {
        isNew: true,
        cwd: '/tmp',
        cols: 80,
        rows: 24
      })
    })
    expectUntouchedLiveSession()
  })

  it('respawn through openSession keeps the new session live', async () => {
    await exitWithBarrier(async () => {
      await history().openSession('pty-1', { cwd: '/tmp/new', cols: 80, rows: 24 })
    })
    expectUntouchedLiveSession()
    expect(history().readMeta('pty-1')?.cwd).toBe('/tmp/new')
  })

  it('without a respawn, the final checkpoint, records and endedAt are all written (control)', async () => {
    await exitWithBarrier(null)
    expect(history().readMeta('pty-1')?.endedAt).toEqual(expect.any(String))
    expect(history()['writers'].has('pty-1')).toBe(false)
    expect(readIfExists('checkpoint.json')).toContain('OLD-SESSION-SNAPSHOT')
    expect(readIfExists('output.log')).toContain('OLD-SESSION-OUTPUT')
  })

  it('an in-flight periodic checkpoint is not published after the id is respawned', async () => {
    const manager = history()
    await manager.openSession('pty-1', { cwd: '/tmp', cols: 80, rows: 24 })
    const gate = blockCheckpointTmpWrite()
    const ticking = manager.checkpoint('pty-1', snapshot)
    await gate.started
    await manager.openSession('pty-1', { cwd: '/tmp/new', cols: 80, rows: 24 })
    gate.release()
    await ticking
    expect(readdirSync(sessionDir())).toEqual(['meta.json'])
  })
})
