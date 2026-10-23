import { createHash, randomUUID } from 'node:crypto'
import type { DobiusTerminalClient, DobiusTerminalResult } from '../adapters/dobius.js'
import type { AdamDatabase } from '../db/database.js'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

export type PreparedDispatch = {
  id: string
  created: boolean
  state: string
  promptDigest: string
}

export class TerminalDispatcher {
  constructor(private readonly db: AdamDatabase, private readonly dobius: DobiusTerminalClient) {}

  async prepare(input: {
    terminalHandle: string
    worktreeId: string
    prompt: string
    idempotencyKey: string
    jobId?: string
    authorizedBy?: string
    authorizationSource?: string
    promptMode?: 'literal' | 'engineered'
    // The resolved context pack. Required: an optional gate is not a gate, and
    // the typechecker guarantees no caller reaches a writable terminal without
    // first passing the handshake (see projects/handshake.ts).
    contextPack: { digest: string; json: string }
  }): Promise<PreparedDispatch> {
    const existing = this.db.prepare('SELECT id, state, prompt_digest FROM prompt_dispatches WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as { id: string; state: string; prompt_digest: string } | undefined
    if (existing) return { id: existing.id, created: false, state: existing.state, promptDigest: existing.prompt_digest }

    const identity = await this.dobius.terminalShow(input.terminalHandle)
    const activity = await this.dobius.terminalRead(input.terminalHandle, 20)
    const snapshot = { identity, activity }
    const actualWorktree = String(identity.terminal.worktreeId ?? '')
    if (!actualWorktree || actualWorktree !== input.worktreeId) {
      throw new Error(`Terminal target mismatch: expected ${input.worktreeId}, observed ${actualWorktree || 'unknown'}`)
    }
    const id = randomUUID()
    const at = new Date().toISOString()
    const promptDigest = digest(input.prompt)
    this.db.prepare(`
      INSERT INTO prompt_dispatches
        (id, job_id, terminal_handle, worktree_id, prompt_digest, idempotency_key, prompt_text,
         pre_snapshot, prepared_at, authorized_by, authorization_source, authorized_at, prompt_mode,
         context_pack_digest, context_pack)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.jobId ?? null, input.terminalHandle, input.worktreeId, promptDigest,
      input.idempotencyKey, input.prompt, JSON.stringify(snapshot), at,
      input.authorizedBy ?? null, input.authorizationSource ?? null,
      input.authorizedBy ? at : null, input.promptMode ?? 'engineered',
      input.contextPack.digest, input.contextPack.json
    )
    return { id, created: true, state: 'prepared', promptDigest }
  }

  async sendPrepared(id: string): Promise<{ sent: boolean; receipt: DobiusTerminalResult }> {
    const row = this.db.prepare('SELECT * FROM prompt_dispatches WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`Dispatch not found: ${id}`)
    if (row.authorized_by !== 'carson' || !row.authorized_at) throw new Error('Dispatch lacks exact Carson authorization')
    if (row.state !== 'prepared') {
      return { sent: false, receipt: JSON.parse(String(row.receipt ?? '{}')) as DobiusTerminalResult }
    }
    const receipt = await this.dobius.terminalSend(String(row.terminal_handle), String(row.prompt_text))
    this.db.prepare("UPDATE prompt_dispatches SET state = 'sent', receipt = ?, sent_at = ? WHERE id = ? AND state = 'prepared'")
      .run(JSON.stringify(receipt), new Date().toISOString(), id)
    return { sent: true, receipt }
  }

  async verify(id: string): Promise<{ passed: boolean; checks: Record<string, boolean> }> {
    const row = this.db.prepare('SELECT * FROM prompt_dispatches WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`Dispatch not found: ${id}`)
    const before = JSON.parse(String(row.pre_snapshot)) as { activity?: DobiusTerminalResult }
    const beforeCursor = String(before.activity?.terminal.latestCursor ?? '')
    const identity = await this.dobius.terminalShow(String(row.terminal_handle))
    let activity = await this.dobius.terminalRead(String(row.terminal_handle), 80)
    for (let attempt = 0; attempt < 5 && String(activity.terminal.latestCursor ?? '') === beforeCursor; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      activity = await this.dobius.terminalRead(String(row.terminal_handle), 80)
    }
    const afterCursor = String(activity.terminal.latestCursor ?? '')
    const checks = {
      stateSent: Boolean(row.sent_at),
      receiptPresent: Boolean(row.receipt),
      targetUnchanged: String(identity.terminal.worktreeId ?? '') === String(row.worktree_id),
      terminalObserved: identity.terminal.handle === row.terminal_handle && activity.terminal.handle === row.terminal_handle,
      activityAdvanced: Boolean(afterCursor) && afterCursor !== beforeCursor
    }
    const passed = Object.values(checks).every(Boolean)
    this.db.prepare(`UPDATE prompt_dispatches SET state = ?, post_snapshot = ?, verified_at = ? WHERE id = ?`)
      .run(passed ? 'verified' : 'verification_failed', JSON.stringify({ identity, activity }), new Date().toISOString(), id)
    return { passed, checks }
  }
}
