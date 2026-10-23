import { createHash, randomUUID } from 'node:crypto'
import type { DobiusTerminalClient } from '../adapters/dobius.js'
import type { AdamDatabase } from '../db/database.js'

type MonitorRow = {
  id: string
  terminal_handle: string
  worktree_id: string
  label: string | null
  recipient: string
  state: string
  last_snapshot_digest: string | null
  last_agent_state: string | null
  last_output: string | null
  last_checked_at: string | null
  last_notified_at: string | null
  error: string | null
}

export type SessionSnapshot = {
  terminalHandle: string
  worktreeId: string
  state: string
  output: string
  digest: string
  checkedAt: string
}

function digestSnapshot(state: string, output: string): string {
  return createHash('sha256').update(`${state}\n${output}`).digest('hex')
}

export class SessionMonitor {
  constructor(private readonly db: AdamDatabase, private readonly client: DobiusTerminalClient) {}

  list(): MonitorRow[] {
    return this.db.prepare('SELECT * FROM session_monitors ORDER BY created_at DESC').all() as unknown as MonitorRow[]
  }

  async snapshot(terminalHandle: string, expectedWorktreeId?: string): Promise<SessionSnapshot> {
    const target = await this.client.terminalShow(terminalHandle)
    const result = await this.client.terminalRead(terminalHandle, 120)
    const actualWorktreeId = String(target.terminal.worktreeId ?? result.terminal.worktreeId ?? '')
    if (expectedWorktreeId && actualWorktreeId !== expectedWorktreeId) {
      throw new Error(`Terminal target mismatch: expected worktree ${expectedWorktreeId}, got ${actualWorktreeId || 'unknown'}`)
    }
    let output = (result.terminal.tail ?? []).join('\n').slice(-6_000)
    const paneKey = typeof target.terminal.paneKey === 'string'
      ? target.terminal.paneKey
      : typeof target.terminal.tabId === 'string' && typeof target.terminal.leafId === 'string'
        ? `${target.terminal.tabId}:${target.terminal.leafId}`
        : null
    const known = paneKey
      ? this.db.prepare('SELECT state, last_assistant_message FROM sessions WHERE pane_key = ? ORDER BY last_seen_at DESC LIMIT 1').get(paneKey) as { state: string; last_assistant_message: string | null } | undefined
      : undefined
    const state = String(result.terminal.state ?? target.terminal.state ?? known?.state ?? 'unknown')
    if ((state === 'done' || state === 'blocked' || state === 'waiting') && known?.last_assistant_message?.trim()) {
      output = known.last_assistant_message.trim().slice(-6_000)
    }
    const checkedAt = new Date().toISOString()
    return { terminalHandle, worktreeId: actualWorktreeId, state, output, digest: digestSnapshot(state, output), checkedAt }
  }

  async watch(input: { terminalHandle: string; worktreeId: string; label?: string; recipient: string }): Promise<{ id: string; created: boolean; snapshot: SessionSnapshot }> {
    const snapshot = await this.snapshot(input.terminalHandle, input.worktreeId)
    const now = snapshot.checkedAt
    const existing = this.db.prepare('SELECT id FROM session_monitors WHERE terminal_handle = ? AND recipient = ?')
      .get(input.terminalHandle, input.recipient) as { id: string } | undefined
    const id = existing?.id ?? randomUUID()
    this.db.prepare(`
      INSERT INTO session_monitors
        (id, terminal_handle, worktree_id, label, recipient, state, last_snapshot_digest,
         last_agent_state, last_output, last_checked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(terminal_handle, recipient) DO UPDATE SET
        worktree_id=excluded.worktree_id, label=excluded.label, state='active',
        last_snapshot_digest=excluded.last_snapshot_digest, last_agent_state=excluded.last_agent_state,
        last_output=excluded.last_output, last_checked_at=excluded.last_checked_at,
        error=NULL, updated_at=excluded.updated_at
    `).run(id, input.terminalHandle, input.worktreeId, input.label ?? null, input.recipient,
      snapshot.digest, snapshot.state, snapshot.output, now, now, now)
    return { id, created: !existing, snapshot }
  }

  stop(id: string): boolean {
    return Number(this.db.prepare("UPDATE session_monitors SET state='stopped', updated_at=? WHERE id=? AND state!='stopped'")
      .run(new Date().toISOString(), id).changes) === 1
  }

  stopAll(): { monitorsStopped: number; alertsCancelled: number; activeRemaining: number; pendingRemaining: number } {
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const monitorsStopped = Number(this.db.prepare("UPDATE session_monitors SET state='stopped', updated_at=? WHERE state IN ('active','paused','error')")
        .run(now).changes)
      const alertsCancelled = Number(this.db.prepare(`UPDATE outbox SET state='failed', last_error='cancelled by Carson monitor-stop command'
        WHERE channel='imessage' AND state='pending' AND dedupe_key LIKE 'session-monitor:%'`).run().changes)
      const activeRemaining = Number(this.db.prepare("SELECT COUNT(*) AS n FROM session_monitors WHERE state='active'").get()?.n ?? 0)
      const pendingRemaining = Number(this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE channel='imessage' AND state='pending' AND dedupe_key LIKE 'session-monitor:%'").get()?.n ?? 0)
      this.db.exec('COMMIT')
      return { monitorsStopped, alertsCancelled, activeRemaining, pendingRemaining }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async reconcile(): Promise<{ checked: number; changed: number; errors: number }> {
    const monitors = this.db.prepare("SELECT * FROM session_monitors WHERE state='active'").all() as unknown as MonitorRow[]
    let changed = 0
    let errors = 0
    for (const monitor of monitors) {
      try {
        const snapshot = await this.snapshot(monitor.terminal_handle, monitor.worktree_id)
        const hasChanged = monitor.last_snapshot_digest !== null && monitor.last_snapshot_digest !== snapshot.digest
        this.db.prepare(`UPDATE session_monitors SET last_snapshot_digest=?, last_agent_state=?, last_output=?,
          last_checked_at=?, error=NULL, updated_at=? WHERE id=?`)
          .run(snapshot.digest, snapshot.state, snapshot.output, snapshot.checkedAt, snapshot.checkedAt, monitor.id)
        const shouldNotify = hasChanged && ['done', 'blocked', 'failed'].includes(snapshot.state)
        if (shouldNotify) {
          changed++
          const label = monitor.label || monitor.terminal_handle
          const recent = snapshot.output.trim().split('\n').slice(-12).join('\n').slice(-1_200)
          const payload = `[Session ${label}] ${snapshot.state}${recent ? `\n${recent}` : '\nNo visible output.'}`
          const dedupe = `session-monitor:${monitor.id}:${snapshot.digest}`
          this.db.prepare(`
            INSERT INTO outbox (id, dedupe_key, channel, recipient, payload, state, next_attempt_at, created_at)
            VALUES (?, ?, 'imessage', ?, ?, 'pending', ?, ?)
            ON CONFLICT(dedupe_key) DO NOTHING
          `).run(randomUUID(), dedupe, monitor.recipient, JSON.stringify({ text: payload, monitorId: monitor.id, digest: snapshot.digest }), snapshot.checkedAt, snapshot.checkedAt)
          this.db.prepare('UPDATE session_monitors SET last_notified_at=? WHERE id=?').run(snapshot.checkedAt, monitor.id)
        }
      } catch (error) {
        errors++
        const message = error instanceof Error ? error.message : String(error)
        this.db.prepare("UPDATE session_monitors SET state='error', error=?, last_checked_at=?, updated_at=? WHERE id=?")
          .run(message, new Date().toISOString(), new Date().toISOString(), monitor.id)
      }
    }
    return { checked: monitors.length, changed, errors }
  }
}
