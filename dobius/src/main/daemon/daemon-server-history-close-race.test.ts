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
import type { SubprocessHandle } from './session'
import { getHistorySessionDirName } from './history-paths'
import type { PendingOutputRecord, TerminalSnapshot } from './types'

const snapshot: TerminalSnapshot = {
  snapshotAnsi: 'old session output\r\n',
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

// Why: the exit handler awaits the final checkpoint before stamping endedAt.
// If the renderer respawns the same ptyId during that await, the new live
// session must not be marked ended by the old session's late close.
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

  const oldRecords: PendingOutputRecord[] = [{ kind: 'output', data: 'OLD-SESSION-OUTPUT' }]

  function sessionFile(name: string): string {
    return join(dir, 'terminal-history', getHistorySessionDirName('pty-1'), name)
  }

  async function closeWithBarrier(
    respawnDuringCheckpoint: boolean,
    records: PendingOutputRecord[] = []
  ): Promise<void> {
    const manager = history()
    await manager.openSession('pty-1', { cwd: '/tmp', cols: 80, rows: 24 })
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(manager, 'checkpoint').mockImplementation(() => barrier)

    const closing = server['closeHistorySession']('pty-1', 0, snapshot, 1, records)
    if (respawnDuringCheckpoint) {
      await manager.openSession('pty-1', { cwd: '/tmp/new', cols: 80, rows: 24 })
    }
    release()
    await closing
  }

  it('does not stamp endedAt onto a session respawned during the final checkpoint', async () => {
    await closeWithBarrier(true)
    expect(history().readMeta('pty-1')).toMatchObject({ cwd: '/tmp/new', endedAt: null })
  })

  it('still stamps endedAt when no respawn happened (control)', async () => {
    await closeWithBarrier(false)
    expect(history().readMeta('pty-1')?.endedAt).toEqual(expect.any(String))
  })

  it("does not append the old session's final records to a respawned session's log", async () => {
    await closeWithBarrier(true, oldRecords)
    const log = sessionFile('output.log')
    expect(existsSync(log) ? readFileSync(log, 'utf-8') : '').not.toContain('OLD-SESSION-OUTPUT')
  })

  it('appends the final records when no respawn happened (control)', async () => {
    await closeWithBarrier(false, oldRecords)
    expect(readFileSync(sessionFile('output.log'), 'utf-8')).toContain('OLD-SESSION-OUTPUT')
  })

  it("does not publish the old session's final checkpoint over a respawned session", async () => {
    const manager = history()
    await manager.openSession('pty-1', { cwd: '/tmp', cols: 80, rows: 24 })
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

    const closing = server['closeHistorySession']('pty-1', 0, snapshot, 1, [])
    await tmpWriteStarted
    await manager.openSession('pty-1', { cwd: '/tmp/new', cols: 80, rows: 24 })
    release()
    await closing

    expect(readdirSync(join(dir, 'terminal-history', getHistorySessionDirName('pty-1')))).toEqual([
      'meta.json'
    ])
    expect(manager.readMeta('pty-1')).toMatchObject({ cwd: '/tmp/new', endedAt: null })
  })
})
