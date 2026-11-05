import { createHash, randomUUID } from 'node:crypto'
import type { DobiusClient } from '../adapters/dobius.js'
import type { AdamDatabase } from '../db/database.js'
import type { TerminalDispatcher } from '../terminals/dispatch.js'
import type { WorkerPreflight } from './preflight.js'
import { resolveLaunchToolPolicy, toolPolicyForLevel, type ToolPolicyTier } from './tool-policy.js'
import { renderContextPack, type ContextPack } from '../projects/handshake.js'

type LaunchClient = Pick<DobiusClient, 'worktreeCreate' | 'terminalCreate' | 'terminalWait'>

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

export type WorkerLaunchResult = {
  id: string
  created: boolean
  state: string
  worktreeId: string | null
  worktreePath: string | null
  terminalHandle: string | null
  dispatchId: string | null
}

export class WorkerLauncher {
  constructor(
    private readonly db: AdamDatabase,
    private readonly dobius: LaunchClient,
    private readonly dispatcher: TerminalDispatcher
  ) {}

  async launch(input: {
    idempotencyKey: string
    preflight: WorkerPreflight
    worktreeName: string
    agentType: 'codex' | 'claude'
    promptSource: unknown
    buildPrompt: (target: { worktreeId: string; worktreePath: string; terminalHandle: string; branch?: string }) => string
    setupPolicy: 'run' | 'skip' | 'inherit'
    authorizedBy: 'carson'
    authorizationSource: string
    // The resolved context pack for the repo this worker is launched into.
    // Required: the caller must pass the handshake before a writable agent
    // exists (see projects/handshake.ts). Recorded on the launch row and
    // forwarded to the prompt dispatch.
    contextPack: { digest: string; json: string }
    readinessLevel?: number
    // Declared spend ceiling in USD. Recorded on the launch row via the
    // greppable BUDGET CAP prompt suffix; NOT enforced by the interactive
    // session (claude --max-budget-usd only works with --print).
    maxBudgetUsd?: number
  }): Promise<WorkerLaunchResult> {
    const requestDigest = digest(JSON.stringify(input.promptSource))
    const existing = this.rowByKey(input.idempotencyKey)
    if (existing) {
      if (existing.request_digest && existing.request_digest !== requestDigest) {
        throw new Error('Idempotency key is already bound to a different worker launch request')
      }
      return this.result(existing, false)
    }
    if (!['isolated_new_worktree', 'independent_full_handoff'].includes(input.preflight.workspaceMode)) {
      throw new Error(`Worker launch requires a new-worktree mode, received ${input.preflight.workspaceMode}`)
    }
    const toolPolicy = resolveLaunchToolPolicy(input.readinessLevel)
    // Single source of truth for authority: the tier the pack was resolved at
    // and the tier this launch derives from readiness must agree, or we refuse
    // rather than launch with two conflicting authority statements.
    const pack = JSON.parse(input.contextPack.json) as ContextPack
    const expectedTier: ToolPolicyTier = input.readinessLevel === undefined
      ? 'restricted'
      : toolPolicyForLevel(input.readinessLevel).tier
    if (pack.toolPolicyTier !== expectedTier) {
      throw new Error(`Context pack tool policy tier (${String(pack.toolPolicyTier)}) disagrees with the launch tier (${expectedTier}); refusing to launch`)
    }
    if (input.maxBudgetUsd !== undefined && (!Number.isFinite(input.maxBudgetUsd) || input.maxBudgetUsd <= 0)) {
      throw new Error(`maxBudgetUsd must be a positive finite number of US dollars, received ${String(input.maxBudgetUsd)}`)
    }
    const budgetCap = input.maxBudgetUsd === undefined ? '' : [
      'BUDGET CAP (recorded, not enforced by this session):',
      `$${input.maxBudgetUsd.toFixed(2)} USD maximum spend for this worker.`,
      'The interactive agent session does not enforce a hard spend cap',
      '(claude --max-budget-usd requires --print mode).',
      'Real enforcement requires print-mode workers or Dobius+-side spend limits.'
    ].join(' ')
    const id = randomUUID()
    const at = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO worker_launches (
        id, idempotency_key, repo_id, repo_path, worktree_name, workspace_mode, base_ref,
        base_ref_source, agent_type, prompt_digest, prompt_text, setup_policy, authorized_by,
        authorization_source, created_at, request_digest, context_pack_digest, context_pack
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.idempotencyKey, input.preflight.repo.id, input.preflight.repo.path,
      input.worktreeName, input.preflight.workspaceMode, input.preflight.baseRef,
      input.preflight.baseRefSource, input.agentType, digest(JSON.stringify(input.promptSource)), JSON.stringify(input.promptSource),
      input.setupPolicy, input.authorizedBy, input.authorizationSource, at, requestDigest,
      input.contextPack.digest, input.contextPack.json
    )
    try {
      this.db.prepare("UPDATE worker_launches SET state = 'creating_worktree' WHERE id = ?").run(id)
      const created = await this.dobius.worktreeCreate({
        repoSelector: `id:${input.preflight.repo.id}`,
        name: input.worktreeName,
        baseRef: input.preflight.baseRef,
        noParent: true,
        setup: input.setupPolicy
      })
      this.db.prepare(`
        UPDATE worker_launches SET state = 'creating_terminal', worktree_id = ?, worktree_path = ?, launch_receipt = ? WHERE id = ?
      `).run(created.worktree.id, created.worktree.path, JSON.stringify(created), id)

      const terminal = await this.dobius.terminalCreate({
        worktreeSelector: `id:${created.worktree.id}`,
        title: input.worktreeName,
        command: input.agentType
      })
      const handle = terminal.terminal.handle
      this.db.prepare("UPDATE worker_launches SET state = 'waiting_for_agent', terminal_handle = ? WHERE id = ?").run(handle, id)
      await this.dobius.terminalWait(handle, 'tui-idle', 60_000)

      // Order: prompt, context pack, tool policy, budget cap. The agent sees
      // where it is and what it may do before the generic policy text.
      const prompt = `${input.buildPrompt({
        worktreeId: created.worktree.id,
        worktreePath: created.worktree.path,
        terminalHandle: handle,
        ...(created.worktree.branch ? { branch: created.worktree.branch } : {})
      })}\n\n${renderContextPack(pack)}\n\n${toolPolicy}${budgetCap ? `\n\n${budgetCap}` : ''}`
      this.db.prepare('UPDATE worker_launches SET prompt_digest = ?, prompt_text = ? WHERE id = ?')
        .run(digest(prompt), prompt, id)

      const prepared = await this.dispatcher.prepare({
        terminalHandle: handle,
        worktreeId: created.worktree.id,
        prompt,
        idempotencyKey: `worker:${input.idempotencyKey}:prompt`,
        authorizedBy: input.authorizedBy,
        authorizationSource: input.authorizationSource,
        promptMode: 'engineered',
        contextPack: input.contextPack
      })
      await this.dispatcher.sendPrepared(prepared.id)
      const verification = await this.dispatcher.verify(prepared.id)
      if (!verification.passed) throw new Error(`Worker prompt delivery failed: ${JSON.stringify(verification.checks)}`)
      const doneAt = new Date().toISOString()
      this.db.prepare(`
        UPDATE worker_launches SET state = 'verified', dispatch_id = ?, launched_at = ?, verified_at = ? WHERE id = ?
      `).run(prepared.id, doneAt, doneAt, id)
      return this.result(this.rowById(id)!, true)
    } catch (error) {
      this.db.prepare("UPDATE worker_launches SET state = 'failed', error = ? WHERE id = ?")
        .run(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }), id)
      throw error
    }
  }

  private rowByKey(key: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM worker_launches WHERE idempotency_key = ?').get(key) as Record<string, unknown> | undefined
  }

  private rowById(id: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM worker_launches WHERE id = ?').get(id) as Record<string, unknown> | undefined
  }

  private result(row: Record<string, unknown>, created: boolean): WorkerLaunchResult {
    return {
      id: String(row.id), created, state: String(row.state),
      worktreeId: row.worktree_id ? String(row.worktree_id) : null,
      worktreePath: row.worktree_path ? String(row.worktree_path) : null,
      terminalHandle: row.terminal_handle ? String(row.terminal_handle) : null,
      dispatchId: row.dispatch_id ? String(row.dispatch_id) : null
    }
  }
}
