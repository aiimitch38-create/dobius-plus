/**
 * Relay-protocol world operations for CORE's verification-gate scenarios.
 *
 * After this port, core's setup/teardown establishes its world (identity,
 * channel, persona/agent, message, DM) with ZERO vendor imports:
 *   - Steps whose vendor case forwarded to an allowlisted bridge method
 *     became `via: 'method'` dispatches of the RPC method name — those live
 *     in core.scenarios.ts / core-channels.scenarios.ts and do NOT route
 *     through here.
 *   - Everything else (relay publishes/queries, main-process identity and
 *     store reads, constant stubs whose behavior died with the vendored
 *     client) became a DIRECT step: the step object carries a `direct`
 *     function from this module family, and the runner invokes it
 *     in-process.
 *
 * MODULE MAP — this file is the barrel AND the home of identity/lifecycle
 * stubs plus the managed-agent world. The domain operations were split to
 * hold the 300-line lint budget without disables:
 *   - relay-world-wire.ts      protocol kinds, relay URLs, pubkey
 *                              accessors, sign/publish/query primitives
 *   - relay-channel-ops.ts     channel metadata/membership/archive/delete
 *   - relay-message-ops.ts     messages/threads/reactions/DM/profile/feed
 * Everything is re-exported here, so scenario files import from this
 * module only.
 *
 * DIRECT-STEP CONTRACT — the one runner edit the orchestrator needs to make
 * (run-verification.test.ts; ScenarioStep itself gains the field in
 * scenario-contract.ts):
 *
 *   // scenario-contract.ts:
 *   direct?: (ctx: ScenarioContext) => Promise<unknown>
 *
 *   // run-verification.test.ts Pass 1, replacing the bare dispatch when set:
 *   async function runDirectStep(
 *     fn: (ctx: ScenarioContext) => Promise<unknown>,
 *     ctx: ScenarioContext
 *   ): Promise<InvokeOutcome> {
 *     try {
 *       return { threw: false, result: await fn(ctx) }
 *     } catch (error) {
 *       return { threw: true, message: error instanceof Error ? error.message : String(error) }
 *     }
 *   }
 *   // const outcome = step.direct
 *   //   ? await runDirectStep(step.direct, ctx)
 *   //   : isMethodSeam ? await invokeViaGateway(...) : await invoke(...)
 *
 * classifyOutcome, shapeCheck and capture consume the wrapped outcome
 * exactly as they do for dispatched steps. A direct step keeps its vendor
 * command name and its default `via`, so manifest coverage accounting,
 * relay-disposition SKIPPED handling, and the entries/methodEntries split
 * all behave exactly as today.
 *
 * IDENTITY SPLIT (read before touching authorship assertions): these
 * helpers sign with the MAIN-PROCESS participant identity
 * (participant-identity-store.ts, isolated under the harness's mocked
 * homedir) — NOT ctx.selfPubkey, which the runner seeds from the vendored
 * client's localStorage keypair. Every event in this world is authored by
 * the signer exposed via the get_identity step's capture into
 * ctx.family.participantPubkey. Downstream families that assert relay
 * authorship against ctx.selfPubkey must reconcile against that captured
 * pubkey instead.
 */
import type { ScenarioContext, ScenarioStep } from '../scenario-contract'
import {
  ensureParticipantIdentity,
  getParticipantStorageBackend,
  signParticipantEvent
} from '../participant-identity-store'
import { ensureAgentIdentity } from '../agent-participant-identity-store'
import { RELAY_HOST, RELAY_PORT } from '../relay/relay-types'
import { RELAY_HTTP_URL, RELAY_WS_URL } from './relay-world-wire'
import { createAgent, listAgents } from '../../agents/agents-store'
import { listAgentRuns } from '../../agents/agent-runner'

export * from './relay-world-wire'
export * from './relay-channel-ops'
export * from './relay-message-ops'

/** A scenario step that may bypass dispatch and run a direct helper instead. */
export type DirectScenarioStep = ScenarioStep & {
  /** See this module's header for the exact runner contract. */
  direct?: (ctx: ScenarioContext) => Promise<unknown>
}

export const PARTICIPANT_PUBKEY_KEY = 'participantPubkey'

// ── identity / lifecycle stubs ──────────────────────────────────────────────

export async function getRelayHttpUrl(): Promise<string> {
  return RELAY_HTTP_URL
}

export async function getRelayWsUrl(): Promise<string> {
  return RELAY_WS_URL
}

/**
 * The vendored case rejected any URL other than the canonical relay. The
 * canonical constant is derived from the relay's real bind address, so the
 * validation here pins that derivation (scheme + port must be the relay's).
 */
export async function applyWorkspace(): Promise<undefined> {
  const parsed = new URL(RELAY_WS_URL)
  if (parsed.protocol !== 'ws:' || parsed.hostname !== RELAY_HOST || parsed.port !== String(RELAY_PORT)) {
    throw new Error(
      `Dobius Communications requires ${RELAY_WS_URL}; derived ${parsed.toString()}`
    )
  }
  return undefined
}

/**
 * Dobius Communications never shares identity with upstream Buzz — still
 * true now that the main process solely owns the participant key.
 */
export async function isSharedIdentity(): Promise<boolean> {
  return false
}

export type ParticipantIdentityView = {
  pubkey: string
  display_name: string
  storage: 'system-keyring' | 'local-file'
  lost: boolean
  locked: boolean
}

export function participantIdentity(): ParticipantIdentityView {
  const identity = ensureParticipantIdentity()
  return {
    pubkey: identity.pubkey,
    display_name: identity.username,
    storage: getParticipantStorageBackend(),
    lost: false,
    locked: false
  }
}

export async function signProbeEvent(): Promise<string> {
  return JSON.stringify(signParticipantEvent({ kind: 1, content: 'verification probe', tags: [] }))
}

export async function createAuthEvent(): Promise<string> {
  const signed = signParticipantEvent({
    kind: 22242,
    content: '',
    tags: [
      ['relay', RELAY_WS_URL],
      ['challenge', 'verify-challenge']
    ]
  })
  return JSON.stringify(signed)
}

export async function validateReposDir(): Promise<undefined> {
  return undefined
}

export async function setPreventSleepActive(): Promise<undefined> {
  return undefined
}

export type AgentModelCatalog = {
  agentName: string
  agentVersion: string
  models: unknown[]
  agentDefaultModel: null
  selectedModel: null
  supportsSwitching: boolean
}

/** Dobius passes the saved model straight to its native engine; empty catalog by design. */
export function agentModelCatalog(): AgentModelCatalog {
  return {
    agentName: 'Dobius native agent',
    agentVersion: '1',
    models: [],
    agentDefaultModel: null,
    selectedModel: null,
    supportsSwitching: false
  }
}

/** No persistent buzz-acp child processes exist to reconcile or list. */
export async function emptyManagedAgentRuntimes(): Promise<unknown[]> {
  return []
}

/**
 * discover_acp_providers' only backend call was accounts.list over the
 * runtime bridge. Route the attempt through the REAL gateway pipeline so a
 * headless run fails on the genuine unconfigured-account-services error
 * (classified ERROR, whitelisted under this command name) instead of a
 * fabricated throw.
 */
export async function discoverAcpProvidersViaAccountsList(): Promise<unknown> {
  const { createGatewayMethodInvoker } = await import('./runtime-bridge-harness')
  const { invoke } = createGatewayMethodInvoker()
  const response = await invoke('accounts.list')
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`)
  }
  return response.result
}

// ── managed-agent world (main-process stores + agent identity registry) ─────

export type ManagedAgentWorldRecord = {
  pubkey: string
  name: string
  status: 'running' | 'stopped'
  backend_agent_id: string
}

function managedAgentRecords(): ManagedAgentWorldRecord[] {
  const runningIds = new Set(
    listAgentRuns().filter((run) => run.status === 'running').map((run) => run.agentId)
  )
  return listAgents().map((agent) => ({
    pubkey: ensureAgentIdentity(agent.id).pubkey,
    name: agent.name,
    status: runningIds.has(agent.id) ? ('running' as const) : ('stopped' as const),
    backend_agent_id: agent.id
  }))
}

export async function managedAgentsWorldSnapshot(): Promise<ManagedAgentWorldRecord[]> {
  return managedAgentRecords()
}

function findManagedAgentByPersona(personaId: string | undefined): ManagedAgentWorldRecord {
  const record = managedAgentRecords().find((candidate) => candidate.backend_agent_id === personaId)
  if (!record) {
    throw new Error(`Dobius agent not found after creation: ${String(personaId)}`)
  }
  return record
}

export type CreatedPersonaView = {
  agent: {
    id: string
    name: string
    systemPrompt: string
    engine: string
    model: string
  }
}

export async function createPersonaRecord(): Promise<CreatedPersonaView> {
  const agents = createAgent({
    name: 'Verify Persona',
    systemPrompt: 'verification probe',
    engine: 'claude',
    model: 'claude'
  })
  const agent = agents.at(-1)
  if (!agent || agent.name !== 'Verify Persona') {
    throw new Error('Dobius returned an invalid created agent')
  }
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      engine: agent.engine ?? 'claude',
      model: agent.model
    }
  }
}

export async function createManagedAgentFromPersona(ctx: ScenarioContext): Promise<{ agent: ManagedAgentWorldRecord }> {
  return { agent: findManagedAgentByPersona(ctx.personaId) }
}

/**
 * "Start"/"stop" remain readiness projections, not process supervision:
 * Dobius agents are OAuth-backed on-demand workers (same rationale as the
 * vendored projection this replaces).
 */
export async function startManagedAgentWorld(ctx: ScenarioContext): Promise<ManagedAgentWorldRecord & { last_started_at: string }> {
  const agent = findManagedAgentByPubkey(ctx)
  return { ...agent, status: 'running', last_started_at: new Date().toISOString() }
}

export async function stopManagedAgentWorld(ctx: ScenarioContext): Promise<ManagedAgentWorldRecord & { last_stopped_at: string }> {
  const agent = findManagedAgentByPubkey(ctx)
  return { ...agent, status: 'stopped', last_stopped_at: new Date().toISOString() }
}

function findManagedAgentByPubkey(ctx: ScenarioContext): ManagedAgentWorldRecord {
  const pubkey = typeof ctx.managedAgentPubkey === 'string' ? ctx.managedAgentPubkey.toLowerCase() : ''
  const record = managedAgentRecords().find((candidate) => candidate.pubkey.toLowerCase() === pubkey)
  if (!record) {
    throw new Error(`Dobius agent not found for ${pubkey}`)
  }
  return record
}
