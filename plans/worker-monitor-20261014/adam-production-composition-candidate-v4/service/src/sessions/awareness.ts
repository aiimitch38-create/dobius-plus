import { createHash, randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'
import type {
  DobiusAgentStatus,
  DobiusAwarenessClient,
  DobiusWorktreeStatus
} from '../adapters/dobius.js'

const isoFromMillis = (value: number | undefined, fallback: string): string =>
  value ? new Date(value).toISOString() : fallback

function eventKey(worktree: DobiusWorktreeStatus, agent: DobiusAgentStatus): string {
  const source = JSON.stringify({
    worktreeId: worktree.worktreeId,
    paneKey: agent.paneKey,
    state: agent.state,
    prompt: agent.prompt ?? '',
    lastAssistantMessage: agent.lastAssistantMessage ?? '',
    toolName: agent.toolName ?? '',
    toolInput: agent.toolInput ?? '',
    interrupted: agent.interrupted ?? false,
    updatedAt: agent.updatedAt ?? 0
  })
  return createHash('sha256').update(source).digest('hex')
}

export type ReconcileResult = {
  worktrees: number
  sessions: number
  newEvents: number
  active: number
  blocked: number
}

export class SessionAwareness {
  constructor(
    private readonly db: AdamDatabase,
    private readonly client: DobiusAwarenessClient
  ) {}

  async reconcile(now = new Date()): Promise<ReconcileResult> {
    const snapshot = await this.client.worktreePs(100)
    const at = now.toISOString()
    let sessions = 0
    let newEvents = 0
    let active = 0
    let blocked = 0

    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const worktree of snapshot.worktrees) {
        const latestAgents: unknown[] = []
        for (const agent of worktree.agents ?? []) {
          sessions++
          if (agent.state === 'working' || agent.state === 'waiting') active++
          if (agent.state === 'blocked') blocked++
          const sessionId = this.upsertSession(worktree, agent, at)
          const insertedEvent = this.insertEvent(worktree, agent, sessionId, at)
          if (insertedEvent) newEvents++
          latestAgents.push({
            sessionId,
            paneKey: agent.paneKey,
            provider: agent.agentType ?? 'unknown',
            state: agent.state,
            prompt: agent.prompt ?? '',
            result: agent.lastAssistantMessage ?? null,
            updatedAt: isoFromMillis(agent.updatedAt, at)
          })
        }
        this.upsertProjectLedger(worktree, latestAgents, at)
      }
      this.db.prepare(`
        INSERT INTO session_cursors (source_id, cursor, source_digest, updated_at)
        VALUES ('dobius-worktree-ps', ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET cursor = excluded.cursor, source_digest = excluded.source_digest, updated_at = excluded.updated_at
      `).run(at, snapshot.runtimeId ?? null, at)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return { worktrees: snapshot.worktrees.length, sessions, newEvents, active, blocked }
  }

  private upsertSession(worktree: DobiusWorktreeStatus, agent: DobiusAgentStatus, at: string): string {
    const existing = this.db.prepare('SELECT id FROM sessions WHERE provider = ? AND pane_key = ?')
      .get(agent.agentType ?? 'unknown', agent.paneKey) as { id: string } | undefined
    const id = existing?.id ?? randomUUID()
    this.db.prepare(`
      INSERT INTO sessions (
        id, provider, pane_key, worktree_id, project_id, cwd, branch, state, prompt,
        last_assistant_message, source_updated_at, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, pane_key) DO UPDATE SET
        worktree_id = excluded.worktree_id,
        project_id = excluded.project_id,
        cwd = excluded.cwd,
        branch = excluded.branch,
        state = excluded.state,
        prompt = excluded.prompt,
        last_assistant_message = excluded.last_assistant_message,
        source_updated_at = excluded.source_updated_at,
        last_seen_at = excluded.last_seen_at
    `).run(
      id,
      agent.agentType ?? 'unknown',
      agent.paneKey,
      worktree.worktreeId,
      worktree.repoId ?? worktree.repo ?? worktree.path,
      worktree.path,
      worktree.branch ?? null,
      agent.state,
      agent.prompt ?? null,
      agent.lastAssistantMessage ?? null,
      isoFromMillis(agent.updatedAt, at),
      at,
      at
    )
    return id
  }

  private insertEvent(
    worktree: DobiusWorktreeStatus,
    agent: DobiusAgentStatus,
    sessionId: string,
    at: string
  ): boolean {
    const key = eventKey(worktree, agent)
    const id = randomUUID()
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO events (id, event_key, session_id, project_id, type, payload, occurred_at, ingested_at)
      VALUES (?, ?, ?, ?, 'agent.status', ?, ?, ?)
    `).run(
      id,
      key,
      sessionId,
      worktree.repoId ?? worktree.repo ?? worktree.path,
      JSON.stringify({ worktree, agent }),
      isoFromMillis(agent.updatedAt, at),
      at
    )
    return result.changes === 1
  }

  private upsertProjectLedger(worktree: DobiusWorktreeStatus, agents: unknown[], at: string): void {
    const projectId = worktree.repoId ?? worktree.repo ?? worktree.path
    const state = {
      repo: worktree.repo ?? null,
      path: worktree.path,
      branch: worktree.branch ?? null,
      worktreeStatus: worktree.status ?? null,
      lastOutputAt: worktree.lastOutputAt ? new Date(worktree.lastOutputAt).toISOString() : null,
      agents
    }
    this.db.prepare(`
      INSERT INTO project_ledger (project_id, current_state, valid_at, confidence, updated_at)
      VALUES (?, ?, ?, 1.0, ?)
      ON CONFLICT(project_id) DO UPDATE SET current_state = excluded.current_state, valid_at = excluded.valid_at,
        confidence = excluded.confidence, updated_at = excluded.updated_at
    `).run(projectId, JSON.stringify(state), at, at)
  }
}
