/**
 * Verification-harness fixtures for this feature's 9 teams-snapshots RPC
 * methods (snapshot-rpc-methods.ts). Spliced into ../verify/command-scenario.ts's
 * SCENARIO by the harness owner; this module never edits verify/ itself.
 *
 * SEAM + UNIQUENESS: every step sets via: 'method' - the camelCase snapshot.*
 * names have no case in the vendored Buzz client's snake_case Tauri switch,
 * so the real gateway pipeline (sender-trust + COMMUNICATIONS_RUNTIME_METHODS
 * allowlist + dispatcher, src/shared/communications-bridge.ts) is the only
 * path they can be exercised over. That gate also requires each method name
 * exactly once across SCENARIO: fixture creation rides the seam itself
 * ('agent.create'); teardown uses DIRECT store calls (removeAgent/removeTeam,
 * not dispatches) inside the last creating step - this file's predecessor's
 * pattern for the same counting constraint.
 *
 * CHAINING: the agent chain mints its own fixture CustomAgent (no dependence
 * on other families' captures) and passes encoded fileBytes create -> encode
 * -> preview -> confirm via ctx.family, mirroring the UI round trip. The
 * team import steps consume hand-built envelope bytes (exactly what
 * encodeEnvelope's 'json' format emits) because no live team exists when
 * families run: ctx.teamId's team is deleted by teams.scenarios' delete_team
 * before any later family executes, and minting one via team RPC methods
 * would duplicate core's fixtures.
 *
 * NO POSITIVE PATH, deliberately:
 *   - *.snapshot.export: success tail opens a native save dialog -
 *     unreachable headless (mocked electron exposes no `dialog`). Verified
 *     up to the last reachable behavior instead: the REAL store lookup
 *     rejecting a guaranteed-nonexistent id, exact error via `expectedError`
 *     (classify.ts's sanctioned pairing for an always-rejecting fixture).
 *   - snapshot.fetchBytes: success tail needs an HTTP attachment server on
 *     localhost:3300 that no harness component stands up (logic unit-covered
 *     in snapshot-fetch.test.ts). Pinned instead: SSRF mitigation #1, the
 *     origin allowlist, which throws before ANY network I/O.
 *
 * CLEANUP: team.snapshot.confirmImport's shapeCheck removes every record the
 * block created once its assertions pass; if an upstream step broke, the
 * gate already shows non-PASS and leftovers stay in the run's isolated
 * scratch userData (runtime-bridge-harness.ts), never a real profile. No
 * requiresSecondBoundary anywhere: nothing publishes relay events.
 */
import { fail, hasStringField, isRecord, ok, randomHexPubkey, type ScenarioStep, type ShapeOutcome } from '../scenario-contract'
import { removeAgent } from '../../agents/agents-store'
import { removeTeam } from '../team-store'

const SOURCE_AGENT_NAME = 'Verify Snapshot Source'
const SOURCE_AGENT_PROMPT = 'Be a verification fixture'
const SOURCE_AGENT_MODEL = 'claude-opus-4-8'

// Matches agent-snapshot.ts's name sanitization of SOURCE_AGENT_NAME:
// non-word runs collapse to '-', then '.agent.json' for format 'json'.
const ENCODED_AGENT_FILENAME = 'Verify-Snapshot-Source.agent.json'

// Byte-for-byte what encodeEnvelope(envelope, 'json') emits for this shape
// (plain UTF-8 JSON; see snapshot-codec.ts). Member B exercises the null
// fields and 'codex'-runtime branch of parseAgentEnvelopeFields /
// createAgentFromEnvelope.
function snapshotMember(displayName: string, systemPrompt: string | null, runtime: 'claude' | 'codex'): Record<string, unknown> {
  return {
    displayName, systemPrompt,
    model: runtime === 'claude' ? SOURCE_AGENT_MODEL : null,
    runtime, accountId: null, avatarUrl: null, respondToAllowlist: [], memoryLevel: 'none'
  }
}

const TEAM_SNAPSHOT_ENVELOPE: Record<string, unknown> = {
  magic: 'buzz-team-snapshot',
  version: 1,
  name: 'Verify Snapshot Team',
  description: 'verification fixture team',
  instructions: 'Stay deterministic',
  members: [
    snapshotMember('Verify Snapshot Member A', 'member a prompt', 'claude'),
    snapshotMember('Verify Snapshot Member B', null, 'codex')
  ]
}

const TEAM_SNAPSHOT_ENVELOPE_BYTES: number[] = Array.from(Buffer.from(JSON.stringify(TEAM_SNAPSHOT_ENVELOPE), 'utf-8'))

const HEX_64 = /^[0-9a-f]{64}$/

// Ids nothing in any scenario can ever have created (unique prefix + fresh
// random point-derived hex), so the export handlers' store lookups reject
// them deterministically regardless of where this block is spliced in.
const MISSING_EXPORT_AGENT_ID = `verify-snapshot-export-missing-agent-${randomHexPubkey()}`
const MISSING_EXPORT_TEAM_ID = `verify-snapshot-export-missing-team-${randomHexPubkey()}`

function familyString(ctx: { family: Record<string, unknown> }, key: string): unknown {
  return typeof ctx.family[key] === 'string' && ctx.family[key] !== '' ? ctx.family[key] : undefined
}

/**
 * Every EXPECTED field matches - per-field failure reasons stay specific.
 * Subset semantics: open records (agents-store's CustomAgent roster rows,
 * team-store's Team, import results carrying ids) legitimately hold more
 * fields than any oracle lists, so extras are not an error here; use
 * expectExactShape below for small closed wire types instead.
 */
function expectFieldsStrict(actual: unknown, expected: Record<string, unknown>): ShapeOutcome {
  if (!isRecord(actual)) {
    return fail(`expected an object, got ${typeof actual}`)
  }
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      return fail(`${key}: got ${JSON.stringify(actual[key])}, expected ${JSON.stringify(value)}`)
    }
  }
  return ok()
}

/**
 * expectFieldsStrict PLUS a key-set equality check - for closed wire types
 * whose documented field list is fully enumerable, so an added OR removed
 * field is a finding, not drift to absorb.
 */
function expectExactShape(actual: unknown, expected: Record<string, unknown>): ShapeOutcome {
  const fields = expectFieldsStrict(actual, expected)
  if (!fields.ok || !isRecord(actual)) {
    return fields
  }
  return Object.keys(actual).length === Object.keys(expected).length
    ? ok()
    : fail(`field set drifted: got keys ${JSON.stringify(Object.keys(actual).sort())}`)
}

/**
 * Tears down everything this block persisted, directly through the stores -
 * not RPC dispatches, because the method-seam gate counts distinct command
 * names (see SEAM + UNIQUENESS above). removeAgent/removeTeam cannot throw,
 * so an already-gone record needs no error handling.
 */
function cleanupPersistedRecords(
  ctx: { family: Record<string, unknown> },
  importedMemberPersonaIds: readonly string[],
  importedTeamId: string | null
): void {
  for (const id of [
    familyString(ctx, 'snapshotsSourceAgentId'),
    familyString(ctx, 'snapshotsImportedPersonaId'),
    ...importedMemberPersonaIds
  ]) {
    if (typeof id === 'string') {
      removeAgent(id)
    }
  }
  if (importedTeamId) {
    removeTeam(importedTeamId)
  }
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    // Mints the fixture CustomAgent the whole agent chain encodes from -
    // through the method seam itself, so the block depends on no other
    // family's captures (see CHAINING above). Asserts the store persisted
    // what we asked for, not merely that something came back.
    command: 'agent.create',
    via: 'method',
    args: () => ({ name: SOURCE_AGENT_NAME, systemPrompt: SOURCE_AGENT_PROMPT, engine: 'claude', model: SOURCE_AGENT_MODEL }),
    shapeCheck: (r) => {
      if (!isRecord(r) || !isRecord(r.agent) || !hasStringField(r.agent, 'id')) {
        return fail(`expected { agent: { id, ... } }, got ${JSON.stringify(r)}`)
      }
      return expectFieldsStrict(r.agent, {
        name: SOURCE_AGENT_NAME,
        systemPrompt: SOURCE_AGENT_PROMPT,
        engine: 'claude',
        model: SOURCE_AGENT_MODEL
      })
    },
    capture: (r, ctx) => {
      if (isRecord(r) && isRecord(r.agent) && typeof r.agent.id === 'string') {
        ctx.family.snapshotsSourceAgentId = r.agent.id
      }
    }
  },
  {
    // Encodes the live fixture agent for send. The oracle decodes the bytes
    // back through the envelope contract (magic/version/field echoes),
    // proving real encoding happened rather than any blob-shaped response.
    command: 'agent.snapshot.encode',
    via: 'method',
    args: (ctx) => ({
      id: familyString(ctx, 'snapshotsSourceAgentId'),
      memoryLevel: 'core',
      format: 'json'
    }),
    shapeCheck: (r) => {
      if (
        !isRecord(r) ||
        !Array.isArray(r.fileBytes) ||
        r.fileBytes.length === 0 ||
        typeof r.fileName !== 'string' ||
        !r.fileBytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ) {
        return fail(`expected { fileBytes: byte[], fileName }, got ${JSON.stringify(r)}`)
      }
      if (r.fileName !== ENCODED_AGENT_FILENAME) {
        return fail(`unexpected fileName: ${JSON.stringify(r.fileName)}`)
      }
      let envelope: unknown
      try { envelope = JSON.parse(Buffer.from(r.fileBytes as number[]).toString('utf-8')) } catch {
        return fail('fileBytes did not decode as JSON')
      }
      if (
        !isRecord(envelope) ||
        Object.keys(envelope).length !== 10 ||
        !Array.isArray(envelope.respondToAllowlist) ||
        envelope.respondToAllowlist.length !== 0
      ) {
        return fail(`decoded envelope is not the expected shape: ${JSON.stringify(envelope)}`)
      }
      return expectFieldsStrict(envelope, {
        magic: 'buzz-agent-snapshot', version: 1, displayName: SOURCE_AGENT_NAME,
        systemPrompt: SOURCE_AGENT_PROMPT, model: SOURCE_AGENT_MODEL, runtime: 'claude',
        memoryLevel: 'core', accountId: null, avatarUrl: null
      })
    },
    capture: (r, ctx) => {
      if (isRecord(r) && Array.isArray(r.fileBytes)) {
        ctx.family.snapshotsAgentFileBytes = r.fileBytes
      }
    }
  },
  {
    // Previews exactly the bytes encode produced (the UI's inspect-before-
    // import step). Pins the full AgentSnapshotImportPreview shape including
    // the honesty contracts: memoryEntryCount really 0 (no per-agent memory
    // store) and the allowlist reported absent because the envelope carries
    // none.
    command: 'agent.snapshot.previewImport',
    via: 'method',
    args: (ctx) => ({ fileBytes: ctx.family.snapshotsAgentFileBytes }),
    shapeCheck: (r) =>
      expectExactShape(r, {
        displayName: SOURCE_AGENT_NAME, isBuiltIn: false, model: SOURCE_AGENT_MODEL, runtime: 'claude',
        systemPrompt: SOURCE_AGENT_PROMPT, avatarUrl: null, memoryLevel: 'core', memoryEntryCount: 0,
        hasSourceAllowlist: false, sourceAllowlistCount: 0
      })
  },
  {
    // Confirms the import: creates a brand-new agent from the same bytes.
    // The source agent is still live here, so createAgentFromEnvelope's dedup
    // suffix ("name (2)") is deterministic and asserted - silently reusing or
    // colliding names would be exactly the bug worth pinning.
    command: 'agent.snapshot.confirmImport',
    via: 'method',
    args: (ctx) => ({ fileBytes: ctx.family.snapshotsAgentFileBytes, keepAllowlist: false }),
    shapeCheck: (r) => {
      const scalars =
        isRecord(r) &&
        typeof r.newPubkey === 'string' &&
        HEX_64.test(r.newPubkey) &&
        typeof r.personaId === 'string' &&
        r.personaId !== '' &&
        Array.isArray(r.memoryErrors) &&
        r.memoryErrors.length === 0
      if (!scalars) {
        return fail(`import result failed its shape contract: ${JSON.stringify(r)}`)
      }
      return expectFieldsStrict(r, {
        displayName: `${SOURCE_AGENT_NAME} (2)`,
        memoryWritten: 0,
        memoryTotal: 0,
        profileSyncError: null
      })
    },
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.personaId === 'string') {
        ctx.family.snapshotsImportedPersonaId = r.personaId
      }
    }
  },
  {
    // Previews the hand-built team envelope (module doc explains why the
    // bytes are constructed here rather than encoded from a live team).
    // Drives the real codec decode + per-member parse end to end, including
    // member B's null systemPrompt surviving as null.
    command: 'team.snapshot.previewImport',
    via: 'method',
    args: () => ({ fileBytes: TEAM_SNAPSHOT_ENVELOPE_BYTES }),
    shapeCheck: (r) => {
      const header = expectFieldsStrict(r, {
        name: TEAM_SNAPSHOT_ENVELOPE.name,
        description: TEAM_SNAPSHOT_ENVELOPE.description,
        instructions: TEAM_SNAPSHOT_ENVELOPE.instructions,
        hasSourceAllowlist: false
      })
      if (!header.ok) {
        return header
      }
      if (!isRecord(r) || !Array.isArray(r.members) || r.members.length !== 2) {
        return fail(`expected both members to preview, got ${JSON.stringify(isRecord(r) ? r.members : r)}`)
      }
      const [memberA, memberB] = r.members
      const memberAOk = expectExactShape(memberA, {
        displayName: 'Verify Snapshot Member A', systemPrompt: 'member a prompt', avatarUrl: null,
        hasSourceAllowlist: false, sourceAllowlistCount: 0
      })
      if (!memberAOk.ok) {
        return memberAOk
      }
      return expectExactShape(memberB, {
        displayName: 'Verify Snapshot Member B', systemPrompt: null, avatarUrl: null,
        hasSourceAllowlist: false, sourceAllowlistCount: 0
      })
    }
  },
  {
    // Confirms the team import: one brand-new agent per member plus the team
    // referencing them. keepAllowlist:true exercises the accepted-but-no-op
    // branch the wire contract carries (CustomAgent has no respond-to field
    // to apply it to).
    //
    // This is the block's last CREATING step, so its shapeCheck also tears
    // down everything the block persisted (see CLEANUP in the module doc) -
    // but only after every assertion below has passed, so a broken chain
    // never silently tidies itself away.
    command: 'team.snapshot.confirmImport',
    via: 'method',
    args: () => ({ fileBytes: TEAM_SNAPSHOT_ENVELOPE_BYTES, keepAllowlist: true }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !isRecord(r.team) || !hasStringField(r.team, 'id')) {
        return fail(`expected { team: { id, ... }, personaIds, members }, got ${JSON.stringify(r)}`)
      }
      const header = expectFieldsStrict(r.team, {
        name: TEAM_SNAPSHOT_ENVELOPE.name,
        description: TEAM_SNAPSHOT_ENVELOPE.description,
        instructions: TEAM_SNAPSHOT_ENVELOPE.instructions
      })
      if (!header.ok) {
        return header
      }
      if (
        !Array.isArray(r.personaIds) ||
        r.personaIds.length !== 2 ||
        r.personaIds.some((id) => typeof id !== 'string' || !id)
      ) {
        return fail(`expected two member persona ids, got ${JSON.stringify(r.personaIds)}`)
      }
      if (!Array.isArray(r.members) || r.members.length !== 2) {
        return fail(`expected two member results, got ${JSON.stringify(r.members)}`)
      }
      const memberNames = ['Verify Snapshot Member A', 'Verify Snapshot Member B']
      for (let index = 0; index < 2; index += 1) {
        const member = r.members[index]
        const scalars =
          isRecord(member) &&
          typeof member.pubkey === 'string' &&
          HEX_64.test(member.pubkey) &&
          typeof member.personaId === 'string' &&
          member.personaId !== '' &&
          Array.isArray(member.memoryErrors) &&
          member.memoryErrors.length === 0 &&
          member.personaId === r.personaIds[index]
        if (!scalars) {
          return fail(`member ${index} failed its shape/order contract: ${JSON.stringify(member)}`)
        }
        const fields = expectFieldsStrict(member, {
          displayName: memberNames[index],
          memoryWritten: 0,
          memoryTotal: 0,
          profileSyncError: null
        })
        if (!fields.ok) {
          return fields
        }
      }
      if (!isRecord(r.members[0]) || !isRecord(r.members[1]) || r.members[0].pubkey === r.members[1].pubkey) {
        return fail('each imported member must get its own distinct pubkey')
      }
      const memberIds = [r.members[0].personaId as string, r.members[1].personaId as string]
      ctx.family.snapshotsImportedTeamId = r.team.id
      ctx.family.snapshotsImportedMemberPersonaIds = memberIds
      cleanupPersistedRecords(ctx, memberIds, typeof r.team.id === 'string' ? r.team.id : null)
      return ok()
    }
  },
  {
    // export's GUI tail is unreachable headless (module doc); the last
    // reachable real behavior is the store lookup rejecting a nonexistent
    // id with its exact documented error, via the full gateway pipeline.
    // Trivial shapeCheck is the sanctioned pairing with expectedError.
    // Runs after confirm above and creates nothing, so cleanup is unaffected.
    command: 'agent.snapshot.export',
    via: 'method',
    args: () => ({ id: MISSING_EXPORT_AGENT_ID, memoryLevel: 'none', format: 'json' }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === `Agent not found: ${MISSING_EXPORT_AGENT_ID}`
  },
  {
    // Same rationale as agent.snapshot.export above, against the team store.
    command: 'team.snapshot.export',
    via: 'method',
    args: () => ({ id: MISSING_EXPORT_TEAM_ID, memoryLevel: 'none', format: 'json' }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === `Team not found: ${MISSING_EXPORT_TEAM_ID}`
  },
  {
    // fetchBytes' success tail needs a relay HTTP attachment server nothing
    // in the harness world stands up (module doc). This pins mitigation #1:
    // the SSRF origin allowlist rejecting a non-relay URL before any network
    // I/O - the attacker-controlled-input boundary the handler exists for.
    command: 'snapshot.fetchBytes',
    via: 'method',
    args: () => ({
      url: 'https://attachments.attacker.example/verify-snapshot.agent.json',
      filename: 'verify-snapshot.agent.json', expectedSha256: 'a'.repeat(64), expectedSize: 1024
    }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === 'Snapshot URL must be served by the local relay (http://localhost:3300)'
  }
]
