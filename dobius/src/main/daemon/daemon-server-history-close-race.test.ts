import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  existsSync,
  mkdtempSync,
  promises as fsPromises,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { DaemonServer } from './daemon-server'
import { HistoryManager } from './history-manager'
import { getHistorySessionDirName } from './history-paths'
import type { SubprocessHandle } from './session'
import type { PendingOutputRecord, TerminalSnapshot } from './types'

function makeSnapshot(text: string): TerminalSnapshot {
  return {
    snapshotAnsi: `${text}\r\n`,
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
}

const snapshot = makeSnapshot('OLD-SESSION-SNAPSHOT')
const oldRecords: PendingOutputRecord[] = [{ kind: 'output', data: 'OLD-SESSION-OUTPUT' }]

type Gate = { reached: Promise<void>; release: () => void }

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

  // Holds the Nth checkpoint tmp write open AFTER its bytes hit disk, until
  // gates[N].release() is called. Writes beyond the gate list pass through.
  function gateCheckpointTmpWrites(count: number): Gate[] {
    const gates = Array.from({ length: count }, () => {
      let reach: () => void = () => undefined
      let release: () => void = () => undefined
      const reached = new Promise<void>((resolve) => {
        reach = resolve
      })
      const opened = new Promise<void>((resolve) => {
        release = resolve
      })
      return { reached, release, reach, opened }
    })
    let calls = 0
    const realWriteFile = fsPromises.writeFile.bind(fsPromises)
    vi.spyOn(fsPromises, 'writeFile').mockImplementation(async (...args) => {
      const result = await realWriteFile(...args)
      if (/checkpoint\.json\..*tmp$/.test(String(args[0]))) {
        const gate = gates[calls++]
        if (gate) {
          gate.reach()
          await gate.opened
        }
      }
      return result
    })
    return gates.map(({ reached, release }) => ({ reached, release }))
  }

  async function startSession(): Promise<void> {
    await server['trackHistorySession']('pty-1', { isNew: true, cwd: '/tmp', cols: 80, rows: 24 })
  }

  async function respawnViaCreateOrAttach(): Promise<void> {
    // meta endedAt is still null here, so this takes the registerWriter branch.
    expect(server['historyReader']?.hasRestorableHistory('pty-1')).toBe(true)
    await startSession()
  }

  // Exit pty-1 with a final snapshot + records; optionally act while the
  // final checkpoint's tmp write is held open.
  async function exitWithBarrier(during: (() => Promise<void> | void) | null): Promise<void> {
    await startSession()
    const [gate] = gateCheckpointTmpWrites(1)
    const closing = server['closeHistorySession']('pty-1', 0, snapshot, 1, oldRecords)
    await gate.reached
    await during?.()
    gate.release()
    await closing
  }

  function expectNothingFromOldSession(): void {
    expect(history().readMeta('pty-1')?.endedAt).toBeNull()
    expect(readdirSync(sessionDir()).sort()).toEqual(['meta.json'])
    expect(readIfExists('output.log')).not.toContain('OLD-SESSION-OUTPUT')
  }

  it('production respawn (createOrAttach isNew → registerWriter) keeps the new session live', async () => {
    await exitWithBarrier(respawnViaCreateOrAttach)
    expect(history()['writers'].has('pty-1')).toBe(true)
    expectNothingFromOldSession()
  })

  it('respawn through openSession keeps the new session live', async () => {
    await exitWithBarrier(async () => {
      await history().openSession('pty-1', { cwd: '/tmp/new', cols: 80, rows: 24 })
    })
    expect(history()['writers'].has('pty-1')).toBe(true)
    expectNothingFromOldSession()
    expect(history().readMeta('pty-1')?.cwd).toBe('/tmp/new')
  })

  it('a respawned session released by SIGTERM is not taken over by the old finalization', async () => {
    await exitWithBarrier(async () => {
      await respawnViaCreateOrAttach()
      history().releaseWithoutMarkingEnded()
    })
    expectNothingFromOldSession()
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
    const [gate] = gateCheckpointTmpWrites(1)
    const ticking = manager.checkpoint('pty-1', snapshot)
    await gate.reached
    await manager.openSession('pty-1', { cwd: '/tmp/new', cols: 80, rows: 24 })
    gate.release()
    await ticking
    expect(readdirSync(sessionDir())).toEqual(['meta.json'])
  })

  it("a dropped old checkpoint does not delete the respawned session's checkpoint tmp", async () => {
    await startSession()
    const [oldGate, newGate] = gateCheckpointTmpWrites(2)
    const closing = server['closeHistorySession']('pty-1', 0, snapshot, 1, oldRecords)
    await oldGate.reached
    await respawnViaCreateOrAttach()
    const newCheckpoint = history().checkpoint('pty-1', makeSnapshot('NEW-SESSION-SNAPSHOT'))
    await newGate.reached
    oldGate.release()
    await closing
    newGate.release()
    await newCheckpoint

    expect(history().isSessionDisabled('pty-1')).toBe(false)
    expect(readIfExists('checkpoint.json')).toContain('NEW-SESSION-SNAPSHOT')
    expect(history().readMeta('pty-1')?.endedAt).toBeNull()
  })

  it("an in-flight periodic checkpoint at exit does not delete the final checkpoint's tmp", async () => {
    await startSession()
    const [tickGate, finalGate] = gateCheckpointTmpWrites(2)
    const ticking = history().checkpoint('pty-1', makeSnapshot('TICK-SNAPSHOT'))
    await tickGate.reached
    const closing = server['closeHistorySession']('pty-1', 0, snapshot, 1, oldRecords)
    await finalGate.reached
    tickGate.release()
    await ticking
    finalGate.release()
    await closing

    expect(readIfExists('checkpoint.json')).toContain('OLD-SESSION-SNAPSHOT')
    expect(history().readMeta('pty-1')?.endedAt).toEqual(expect.any(String))
  })

  it('removes crash-leftover checkpoint tmps older than 10 minutes on open, keeps fresh ones', async () => {
    await startSession()
    const stale = join(sessionDir(), 'checkpoint.json.1234.tmp')
    const legacy = join(sessionDir(), 'checkpoint.json.tmp')
    const fresh = join(sessionDir(), 'checkpoint.json.5678.tmp')
    for (const file of [stale, legacy, fresh]) {
      writeFileSync(file, 'x')
    }
    const old = new Date(Date.now() - 11 * 60 * 1000)
    utimesSync(stale, old, old)
    utimesSync(legacy, old, old)

    await history().openSession('pty-1', { cwd: '/tmp', cols: 80, rows: 24 })

    expect(readdirSync(sessionDir()).sort()).toEqual(['checkpoint.json.5678.tmp', 'meta.json'])
  })

  it('registerWriter (warm reattach) also removes stale checkpoint tmps', async () => {
    await startSession()
    const stale = join(sessionDir(), 'checkpoint.json.1234.tmp')
    writeFileSync(stale, 'x')
    const old = new Date(Date.now() - 11 * 60 * 1000)
    utimesSync(stale, old, old)

    new HistoryManager(join(dir, 'terminal-history')).registerWriter('pty-1')

    expect(existsSync(stale)).toBe(false)
  })

  it('reports history write errors with the session id and error code only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = Object.assign(new Error('write failed for SECRET-CONTENT'), { code: 'ENOSPC' })

    history()['handleWriteError']('pty-1', error)

    expect(warn).toHaveBeenCalledWith('[history] write failed:', 'pty-1', 'ENOSPC')
  })
})
