/**
 * Scenario fixtures for the teams-snapshots commands this feature owns:
 * encode/preview/confirm for both agent and team snapshots. Same
 * local-structural-types pattern as workflows.scenarios.ts / team-store.ts's
 * teams.scenarios.ts (see either file's doc comment for why — verify/'s own
 * tsconfig excludes it from a real cross-project import).
 *
 * NOT COVERED, deliberately, with reasons (see the build report's SCENARIOS
 * section too):
 *   - export_agent_snapshot / export_team_snapshot: both open a native
 *     `dialog.showSaveDialog` and block on user interaction. Driving that
 *     from an unattended verification pass would hang the harness, the same
 *     class of "unsafe side effect for an automated fixture" as the
 *     live-agent-run restriction on trigger_workflow.
 *   - fetch_snapshot_bytes: requires a real HTTP round-trip to the local
 *     Dobius relay serving an actual attachment at a real URL/hash/size —
 *     nothing in this scenario harness stands one up. snapshot-fetch.test.ts
 *     already covers its real logic (origin allowlist, hash/size
 *     verification, streaming byte cap) with a fake `fetch`.
 *
 * SETUP/CLEANUP: this family creates its own real fixture data (agents via
 * agents-store.createAgent, a team via team-store.createTeam) as a side
 * effect of an `args()` call rather than as separate SCENARIO_STEPS,
 * because 'create_persona'/'delete_persona'/'create_team'/'delete_team' are
 * each already used exactly once elsewhere in the composed SCENARIO array
 * (CORE_SCENARIO_STEPS and teams.scenarios.ts respectively) — the harness's
 * own invariant test requires every command to appear exactly once, so this
 * family cannot add a second dispatch of any of those. Direct store calls
 * are not RPC dispatches, so they don't collide with that invariant. The
 * final step's shapeCheck removes everything this family created, so the
 * fixture doesn't leak into subsequent runs.
 */
import { createAgent, removeAgent } from '../../agents/agents-store'
import { createTeam, removeTeam } from '../team-store'

type ShapeOutcome = { ok: true } | { ok: false; reason: string }

type SnapshotScenarioContext = {
  family: Record<string, unknown>
}

type SnapshotScenarioStep = {
  command: string
  args: (ctx: SnapshotScenarioContext) => unknown
  shapeCheck: (result: unknown, ctx: SnapshotScenarioContext) => ShapeOutcome
  capture?: (result: unknown, ctx: SnapshotScenarioContext) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok(): ShapeOutcome {
  return { ok: true }
}

function fail(reason: string): ShapeOutcome {
  return { ok: false, reason }
}

function cleanupIds(ctx: SnapshotScenarioContext): void {
  const agentIds = Array.isArray(ctx.family.snapshotAgentIdsToCleanup)
    ? (ctx.family.snapshotAgentIdsToCleanup as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  for (const id of agentIds) {
    try {
      removeAgent(id)
    } catch {
      // Why swallow: cleanup best-effort — a record already gone (e.g. the
      // source agent and the imported copy happen to share cleanup logic)
      // must not fail the whole verification run over a tidy-up step.
    }
  }
  const teamId = typeof ctx.family.snapshotTeamId === 'string' ? ctx.family.snapshotTeamId : null
  if (teamId) {
    try {
      removeTeam(teamId)
    } catch {
      // Same rationale as above.
    }
  }
}

function pushCleanupId(ctx: SnapshotScenarioContext, id: string): void {
  const existing = Array.isArray(ctx.family.snapshotAgentIdsToCleanup)
    ? (ctx.family.snapshotAgentIdsToCleanup as unknown[])
    : []
  ctx.family.snapshotAgentIdsToCleanup = [...existing, id]
}

export const SCENARIO_STEPS: SnapshotScenarioStep[] = [
  {
    command: 'encode_agent_snapshot_for_send',
    args: (ctx) => {
      const agent = createAgent({
        name: 'Verify Snapshot Agent',
        systemPrompt: 'Be a verification fixture',
        engine: 'claude',
        model: 'claude-opus-4-8'
      }).at(-1)!
      pushCleanupId(ctx, agent.id)
      ctx.family.snapshotSourceAgentId = agent.id
      return { id: agent.id, memoryLevel: 'core', format: 'json' }
    },
    shapeCheck: (result) => {
      if (!isRecord(result) || !Array.isArray(result.fileBytes) || typeof result.fileName !== 'string') {
        return fail(`expected { fileBytes, fileName }, got ${JSON.stringify(result)}`)
      }
      if (!result.fileName.endsWith('.agent.json')) {
        return fail(`unexpected fileName: ${result.fileName}`)
      }
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && Array.isArray(result.fileBytes)) {
        ctx.family.agentSnapshotFileBytes = result.fileBytes
      }
    }
  },
  {
    command: 'preview_agent_snapshot_import',
    args: (ctx) => ({ fileBytes: ctx.family.agentSnapshotFileBytes }),
    shapeCheck: (result) => {
      if (!isRecord(result)) {
        return fail('expected an AgentSnapshotImportPreview object')
      }
      if (result.displayName !== 'Verify Snapshot Agent') {
        return fail(`unexpected displayName: ${JSON.stringify(result.displayName)}`)
      }
      if (result.isBuiltIn !== false) {
        return fail('isBuiltIn should be false for an imported snapshot')
      }
      if (result.memoryLevel !== 'core') {
        return fail(`memoryLevel did not round-trip: ${JSON.stringify(result.memoryLevel)}`)
      }
      if (result.memoryEntryCount !== 0) {
        return fail('Dobius has no per-agent memory store yet; memoryEntryCount must be honestly 0')
      }
      return ok()
    }
  },
  {
    command: 'confirm_agent_snapshot_import',
    args: (ctx) => ({ fileBytes: ctx.family.agentSnapshotFileBytes, keepAllowlist: false }),
    shapeCheck: (result) => {
      if (!isRecord(result)) {
        return fail('expected an AgentSnapshotImportResult object')
      }
      if (result.displayName !== 'Verify Snapshot Agent') {
        return fail(`unexpected displayName: ${JSON.stringify(result.displayName)}`)
      }
      if (typeof result.newPubkey !== 'string' || !/^[0-9a-f]{64}$/.test(result.newPubkey)) {
        return fail(`newPubkey should be 64 hex chars, got ${JSON.stringify(result.newPubkey)}`)
      }
      if (typeof result.personaId !== 'string' || !result.personaId) {
        return fail('missing personaId')
      }
      if (result.memoryWritten !== 0 || result.memoryTotal !== 0) {
        return fail('memoryWritten/memoryTotal should be honestly 0 (no memory store to read)')
      }
      if (!Array.isArray(result.memoryErrors) || result.memoryErrors.length !== 0) {
        return fail(`expected empty memoryErrors, got ${JSON.stringify(result.memoryErrors)}`)
      }
      if (result.profileSyncError !== null) {
        return fail(`expected null profileSyncError, got ${JSON.stringify(result.profileSyncError)}`)
      }
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && typeof result.personaId === 'string') {
        pushCleanupId(ctx, result.personaId)
      }
    }
  },
  {
    command: 'encode_team_snapshot_for_send',
    args: (ctx) => {
      const member = createAgent({
        name: 'Verify Snapshot Member',
        systemPrompt: 'member fixture',
        engine: 'claude',
        model: 'claude-opus-4-8'
      }).at(-1)!
      pushCleanupId(ctx, member.id)
      const team = createTeam({
        name: 'Verify Snapshot Team',
        description: 'verification fixture team',
        personaIds: [member.id]
      }).at(-1)!
      ctx.family.snapshotTeamId = team.id
      return { id: team.id, memoryLevel: 'none', format: 'json' }
    },
    shapeCheck: (result) => {
      if (!isRecord(result) || !Array.isArray(result.fileBytes) || typeof result.fileName !== 'string') {
        return fail(`expected { fileBytes, fileName }, got ${JSON.stringify(result)}`)
      }
      if (!result.fileName.endsWith('.team.json')) {
        return fail(`unexpected fileName: ${result.fileName}`)
      }
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && Array.isArray(result.fileBytes)) {
        ctx.family.teamSnapshotFileBytes = result.fileBytes
      }
    }
  },
  {
    command: 'preview_team_snapshot_import',
    args: (ctx) => ({ fileBytes: ctx.family.teamSnapshotFileBytes }),
    shapeCheck: (result) => {
      if (!isRecord(result)) {
        return fail('expected a TeamSnapshotImportPreview object')
      }
      if (result.name !== 'Verify Snapshot Team') {
        return fail(`unexpected name: ${JSON.stringify(result.name)}`)
      }
      if (!Array.isArray(result.members) || result.members.length !== 1) {
        return fail(`expected exactly one member, got ${JSON.stringify(result.members)}`)
      }
      const member = result.members[0]
      if (!isRecord(member) || member.displayName !== 'Verify Snapshot Member') {
        return fail(`unexpected member: ${JSON.stringify(member)}`)
      }
      return ok()
    }
  },
  {
    command: 'confirm_team_snapshot_import',
    args: (ctx) => ({ fileBytes: ctx.family.teamSnapshotFileBytes, keepAllowlist: false }),
    shapeCheck: (result, ctx) => {
      if (!isRecord(result) || !isRecord(result.team)) {
        return fail('expected a TeamSnapshotImportResult object with a team')
      }
      if (result.team.name !== 'Verify Snapshot Team') {
        return fail(`unexpected imported team name: ${JSON.stringify(result.team.name)}`)
      }
      if (!Array.isArray(result.personaIds) || result.personaIds.length !== 1) {
        return fail(`expected exactly one imported member id, got ${JSON.stringify(result.personaIds)}`)
      }
      if (!Array.isArray(result.members) || result.members.length !== 1) {
        return fail('expected exactly one member result')
      }
      const member = result.members[0]
      if (!isRecord(member) || typeof member.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(member.pubkey)) {
        return fail(`member.pubkey should be 64 hex chars, got ${JSON.stringify(member)}`)
      }
      if (!Array.isArray(member.memoryErrors) || member.memoryErrors.length !== 0) {
        return fail('expected the good member to import without errors')
      }
      // Everything this family created (directly via the store, and via
      // this final import) gets torn down now that every assertion above
      // has run — see the file doc comment for why cleanup lives here
      // instead of as its own SCENARIO_STEPS entries.
      if (typeof member.personaId === 'string' && member.personaId) {
        pushCleanupId(ctx, member.personaId)
      }
      cleanupIds(ctx)
      return ok()
    }
  }
]
