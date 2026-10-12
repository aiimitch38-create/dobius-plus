import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  promises as fsPromises
} from 'node:fs'
import { writeJsonFileAtomic } from '../storage/safe-json-file'
import { getHistorySessionDirName } from './history-paths'
import { encodeLogBatch, encodeLogHeader, LOG_HEADER_BYTES } from './terminal-history-log'
import { removeStaleCheckpointTmps, resolveLogState, type SessionWriter } from './history-log-state'
import type { PendingOutputRecord, TerminalCheckpointFile, TerminalSnapshot } from './types'

// Why 5MB: bounds both cold-restore replay time and disk usage per session.
// Reaching the cap triggers one full snapshot checkpoint (which subsumes and
// resets the log) — one O(buffer) serialize per ~5MB of output instead of one
// per 5-second tick.
const LOG_MAX_BYTES = 5 * 1024 * 1024

export type SessionMeta = {
  cwd: string
  cols: number
  rows: number
  startedAt: string
  endedAt: string | null
  exitCode: number | null
}

export type OpenSessionOptions = {
  cwd: string
  cols: number
  rows: number
}

/** What the daemon took from an exited PTY for its final history write. */
export type FinalHistoryTake = {
  snapshot: TerminalSnapshot
  seq: number
  records: PendingOutputRecord[]
}

export type HistoryManagerOptions = {
  onWriteError?: (sessionId: string, error: Error) => void
}

export class HistoryManager {
  private basePath: string
  private writers = new Map<string, SessionWriter>()
  // Why: bumped on every writer registration so a detached finalization can
  // tell that its id was re-registered even after that newer writer is gone.
  private registrations = new Map<string, number>()
  private registrationSerial = 0
  private disabledSessions = new Set<string>()
  private onWriteError?: (sessionId: string, error: Error) => void

  constructor(basePath: string, opts?: HistoryManagerOptions) {
    this.basePath = basePath
    this.onWriteError = opts?.onWriteError
  }

  async openSession(sessionId: string, opts: OpenSessionOptions): Promise<void> {
    try {
      this.disabledSessions.delete(sessionId)
      const dir = join(this.basePath, getHistorySessionDirName(sessionId))
      mkdirSync(dir, { recursive: true })

      const meta: SessionMeta = {
        cwd: opts.cwd,
        cols: opts.cols,
        rows: opts.rows,
        startedAt: new Date().toISOString(),
        endedAt: null,
        exitCode: null
      }
      // Why atomic: a torn meta.json reads as "no session" (cwd/dims + restore lost).
      writeJsonFileAtomic(join(dir, 'meta.json'), meta)

      // Why: if a session ID is reused after a previous clean exit, stale
      // recovery files may still be on disk. Without removing them, a crash
      // before the first 5s checkpoint tick would cause detectColdRestore to
      // replay stale terminal content from the previous session. Both
      // checkpoint.json and scrollback.bin (legacy) must be cleaned up
      // because the reader falls back to scrollback.bin when no checkpoint
      // exists.
      const checkpointPath = join(dir, 'checkpoint.json')
      const logPath = join(dir, 'output.log')
      for (const staleFile of [checkpointPath, join(dir, 'scrollback.bin'), logPath]) {
        try {
          unlinkSync(staleFile)
        } catch {
          // ENOENT is expected for new sessions
        }
      }

      removeStaleCheckpointTmps(dir, Date.now())
      this.setWriter(sessionId, { dir, checkpointPath, logPath, logGeneration: 0, logBytes: 0 })
    } catch (err) {
      this.handleWriteError(sessionId, err)
    }
  }

  // Why: on warm reattach after app relaunch, the HistoryManager is a fresh
  // instance with no in-memory writers. This registers the writer so
  // checkpoint() calls work, without overwriting meta.json or deleting the
  // existing checkpoint.json (which is the only valid recovery data until
  // the next checkpoint tick writes a fresh one).
  registerWriter(sessionId: string): void {
    if (this.writers.has(sessionId)) {
      return
    }
    const dir = join(this.basePath, getHistorySessionDirName(sessionId))
    removeStaleCheckpointTmps(dir, Date.now())
    this.setWriter(sessionId, {
      dir,
      checkpointPath: join(dir, 'checkpoint.json'),
      logPath: join(dir, 'output.log'),
      logGeneration: null,
      logBytes: null
    })
  }

  private setWriter(sessionId: string, writer: SessionWriter): void {
    this.writers.set(sessionId, writer)
    this.registrations.set(sessionId, ++this.registrationSerial)
  }

  /** Appends one take batch to the incremental log. Returns 'needs-checkpoint'
   *  when the log is at capacity — the caller must take a full snapshot, which
   *  subsumes the un-appended records (they were already applied to the live
   *  emulator) and resets the log via checkpoint(). */
  async appendIncrements(
    sessionId: string,
    seq: number,
    records: PendingOutputRecord[]
  ): Promise<'ok' | 'needs-checkpoint'> {
    if (this.disabledSessions.has(sessionId) || records.length === 0) {
      return 'ok'
    }
    const writer = this.writers.get(sessionId)
    if (!writer) {
      return 'ok'
    }
    try {
      resolveLogState(writer)
      const batch = encodeLogBatch(seq, records)
      // Why max(..., header): a fresh log gets its header written below, so
      // the projected size must include it or the cap can be overshot.
      const projectedBytes = Math.max(writer.logBytes ?? 0, LOG_HEADER_BYTES) + batch.length
      if (projectedBytes > LOG_MAX_BYTES) {
        return 'needs-checkpoint'
      }
      if (writer.logBytes === 0) {
        // Why: header carries the generation that ties this log to its base
        // checkpoint; written lazily so warm reattaches never clobber a log
        // that already has appended batches.
        await fsPromises.writeFile(writer.logPath, encodeLogHeader(writer.logGeneration ?? 0))
        writer.logBytes = LOG_HEADER_BYTES
      }
      await fsPromises.appendFile(writer.logPath, batch)
      writer.logBytes = (writer.logBytes ?? LOG_HEADER_BYTES) + batch.length
      return 'ok'
    } catch (err) {
      this.handleWriteError(sessionId, err)
      return 'ok'
    }
  }

  // Why: replaces the old appendData (which wrote every PTY chunk to disk).
  // Full checkpoints are now rare (clean disconnect, pending-buffer overflow,
  // log cap); the 5s tick appends increments via appendIncrements instead.
  async checkpoint(sessionId: string, snapshot: TerminalSnapshot): Promise<void> {
    if (this.disabledSessions.has(sessionId)) {
      return
    }
    const writer = this.writers.get(sessionId)
    if (!writer) {
      return
    }
    try {
      await this.writeCheckpoint(writer, snapshot, () => this.writers.get(sessionId) === writer)
    } catch (err) {
      this.handleWriteError(sessionId, err)
    }
  }

  /** Returns false when `owns()` turned false before the checkpoint was published. */
  private async writeCheckpoint(
    writer: SessionWriter,
    snapshot: TerminalSnapshot,
    owns: () => boolean
  ): Promise<boolean> {
    // Why: shells that haven't emitted OSC-7 have snapshot.cwd = null.
    // Persisting null would overwrite the usable cwd from meta.json,
    // breaking cold restore cwd recovery. Fall back to the meta cwd
    // so the revived shell inherits the original working directory.
    let effectiveCwd = snapshot.cwd
    if (effectiveCwd === null) {
      const meta = this.readMetaFromDir(writer.dir)
      effectiveCwd = meta?.cwd ?? null
    }

    resolveLogState(writer)
    const generation = (writer.logGeneration ?? 0) + 1
    const checkpointFile: TerminalCheckpointFile = {
      snapshotAnsi: snapshot.snapshotAnsi,
      scrollbackAnsi: snapshot.scrollbackAnsi,
      oscLinks: snapshot.oscLinks,
      rehydrateSequences: snapshot.rehydrateSequences,
      cwd: effectiveCwd,
      cols: snapshot.cols,
      rows: snapshot.rows,
      modes: snapshot.modes,
      scrollbackLines: snapshot.scrollbackLines,
      generation,
      checkpointedAt: new Date().toISOString()
    }
    const data = JSON.stringify(checkpointFile)
    // Why: atomic write via tmp+rename prevents half-written checkpoints
    // on crash. Reading a corrupt checkpoint is worse than reading a
    // slightly stale one. Async IO — a sync ~MB write (worse under
    // antivirus scanning on Windows) would stall input/IPC for its
    // duration. Why a unique name: a periodic and a final checkpoint (or an old
    // and a respawned writer) can overlap, and must never share or delete one tmp.
    const tmpPath = `${writer.checkpointPath}.${randomUUID()}.tmp`
    await fsPromises.writeFile(tmpPath, data)
    // Why: the same id can be respawned (same dir) during the await above;
    // then the old session's snapshot must not be published into it.
    if (!owns()) {
      await fsPromises.rm(tmpPath, { force: true })
      return false
    }
    // Why sync: nothing may run between the owner check and the publish.
    renameSync(tmpPath, writer.checkpointPath)
    // Why: the snapshot subsumes every logged record, so the log resets to
    // the new generation. Crash between rename and this reset is safe: the
    // stale log's generation no longer matches the checkpoint's, so the
    // restore reader ignores it.
    writeFileSync(writer.logPath, encodeLogHeader(generation))
    writer.logGeneration = generation
    writer.logBytes = LOG_HEADER_BYTES
    return true
  }

  async closeSession(sessionId: string, exitCode: number): Promise<void> {
    const writer = this.writers.get(sessionId)
    if (!writer) {
      return
    }
    this.writers.delete(sessionId)
    this.registrations.delete(sessionId)
    this.markEnded(sessionId, writer, exitCode)
  }

  /** Final checkpoint + endedAt for an exited PTY. The writer is detached
   *  synchronously, so a respawn of the same id registers its own writer; once
   *  one exists, the dir belongs to the new session and this stops writing. */
  async finalizeSession(
    sessionId: string,
    exitCode: number,
    take: FinalHistoryTake | null
  ): Promise<void> {
    const writer = this.writers.get(sessionId)
    if (!writer) {
      return
    }
    this.writers.delete(sessionId)
    const registration = this.registrations.get(sessionId)
    const owns = (): boolean =>
      this.registrations.get(sessionId) === registration && !this.writers.has(sessionId)
    if (take && !this.disabledSessions.has(sessionId)) {
      try {
        const published = await this.writeCheckpoint(writer, take.snapshot, owns)
        const batch = encodeLogBatch(take.seq, take.records)
        // Why sync with no await since the publish: ownership cannot change in between.
        const fits = LOG_HEADER_BYTES + batch.length <= LOG_MAX_BYTES
        if (published && take.records.length > 0 && fits) {
          appendFileSync(writer.logPath, batch)
        }
      } catch (err) {
        this.onWriteError?.(sessionId, err as Error)
      }
    }
    if (owns()) {
      this.registrations.delete(sessionId)
      this.markEnded(sessionId, writer, exitCode)
    }
  }

  private markEnded(sessionId: string, writer: SessionWriter, exitCode: number): void {
    // Why: the session is dead, so its disabled flag is dead state. Without this
    // a session poisoned by a transient mid-life write error leaks its id in
    // disabledSessions forever (sessionIds are fresh per PTY, never reused).
    this.disabledSessions.delete(sessionId)
    try {
      this.updateMeta(writer.dir, { endedAt: new Date().toISOString(), exitCode })
    } catch (err) {
      // Why: if endedAt can't be written, the session looks like an unclean
      // shutdown and triggers a false cold restore on next launch. Disable
      // further writes and report, but don't crash the app.
      this.handleWriteError(sessionId, err)
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    this.writers.delete(sessionId)
    this.registrations.delete(sessionId)
    this.disabledSessions.delete(sessionId)
    rmSync(join(this.basePath, getHistorySessionDirName(sessionId)), {
      recursive: true,
      force: true
    })
  }

  isSessionDisabled(sessionId: string): boolean {
    return this.disabledSessions.has(sessionId)
  }

  disabledSessionCount(): number {
    return this.disabledSessions.size
  }

  hasHistory(sessionId: string): boolean {
    return existsSync(join(this.basePath, getHistorySessionDirName(sessionId), 'meta.json'))
  }

  readMeta(sessionId: string): SessionMeta | null {
    const metaPath = join(this.basePath, getHistorySessionDirName(sessionId), 'meta.json')
    if (!existsSync(metaPath)) {
      return null
    }
    try {
      return JSON.parse(readFileSync(metaPath, 'utf-8'))
    } catch {
      return null
    }
  }

  async dispose(): Promise<void> {
    // Why: mark all open sessions as cleanly ended so they don't trigger
    // false cold-restores on next launch.
    for (const [sessionId, writer] of this.writers) {
      try {
        this.updateMeta(writer.dir, { endedAt: new Date().toISOString(), exitCode: null })
      } catch {
        this.disabledSessions.add(sessionId)
      }
    }
    this.writers.clear()
  }

  // Why: signal-driven daemon shutdown (OS reboot, updater, killall) must
  // leave meta endedAt null so the next launch cold-restores scrollback and
  // auto-resumes agent sessions. Clearing writers first also keeps the
  // PTY-kill exit events during teardown from writing endedAt via closeSession.
  releaseWithoutMarkingEnded(): void {
    this.writers.clear()
    this.disabledSessions.clear()
  }

  // Why: history is best-effort — any error should disable the session
  // rather than crash the app. Callers use fire-and-forget `void` promises,
  // so a re-thrown error would become an unhandled rejection.
  private handleWriteError(sessionId: string, err: unknown): void {
    this.disabledSessions.add(sessionId)
    this.onWriteError?.(sessionId, err as Error)
  }

  private readMetaFromDir(dir: string): SessionMeta | null {
    const metaPath = join(dir, 'meta.json')
    try {
      return JSON.parse(readFileSync(metaPath, 'utf-8'))
    } catch {
      return null
    }
  }

  private updateMeta(dir: string, updates: Partial<SessionMeta>): void {
    const metaPath = join(dir, 'meta.json')
    let meta: SessionMeta
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    } catch {
      return
    }
    Object.assign(meta, updates)
    writeJsonFileAtomic(metaPath, meta)
  }
}
