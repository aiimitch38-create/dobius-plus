import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../../runtime/rpc/core'
import { OptionalPlainString, OptionalPositiveInt, requiredString } from '../../runtime/rpc/schemas'
import {
  getAgentLocalOverrides,
  setAgentLocalOverride
} from './agent-local-overrides-store'
import {
  deleteCustomHarness,
  saveCustomHarness,
  type CustomHarnessDefinition
} from './custom-harness-store'
import {
  getAgentManagedProfiles,
  getGlobalAgentConfig,
  setAgentManagedProfiles,
  setGlobalAgentConfig,
  type GlobalAgentConfig
} from './global-agent-config-store'
import {
  indexObserverChannelIds,
  readIndexedEventsForChannel,
  type ObserverChannelIndexEntry
} from './observer-channel-index-store'
import {
  denyAgentApproval,
  grantAgentApproval,
  listApprovalsForRun
} from './agent-decision-approval-bridge'
import { buildObserverControlEvent, decryptObserverEvent } from './observer-event-crypto'

// ── src/main/communications/agents/*  RPC surface ───────────────────────────
// These methods back the Communications (Buzz) bridge's agent-lifecycle,
// agent-provider-config, and agent-approvals command families. They are NOT
// wired into ALL_RPC_METHODS yet — see the handoff report's ALLOWLIST /
// SWITCH_CASES sections for the registration + vendor case blocks needed to
// reach them from the renderer.

const HarnessDefinition = z.object({
  id: requiredString('Missing harness id'),
  label: requiredString('Missing harness label'),
  command: requiredString('Missing harness command'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  installInstructionsUrl: OptionalPlainString,
  installHint: OptionalPlainString
})

const SaveHarness = z.object({
  definition: HarnessDefinition,
  originalId: OptionalPlainString
})

const HarnessId = z.object({ id: requiredString('Missing harness id') })

function toHarnessDefinition(input: z.infer<typeof HarnessDefinition>): CustomHarnessDefinition {
  return {
    id: input.id,
    label: input.label,
    command: input.command,
    args: input.args ?? [],
    env: input.env ?? {},
    installInstructionsUrl: input.installInstructionsUrl ?? '',
    installHint: input.installHint ?? ''
  }
}

const GlobalAgentConfigInput = z.object({
  env_vars: z.record(z.string(), z.string()).optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  preferred_runtime: z.string().nullable().optional()
})

function toGlobalAgentConfig(input: z.infer<typeof GlobalAgentConfigInput>): GlobalAgentConfig {
  return {
    env_vars: input.env_vars ?? {},
    provider: input.provider ?? null,
    model: input.model ?? null,
    preferred_runtime: input.preferred_runtime ?? null
  }
}

const AgentManagedProfiles = z.object({ enabled: z.boolean() })

const OverrideKey = z.enum(['active', 'autoRestartOnConfigChange', 'startOnAppLaunch'])

const AgentLocalOverrideGet = z.object({ agentId: requiredString('Missing agent id') })

const AgentLocalOverrideSet = z.object({
  agentId: requiredString('Missing agent id'),
  key: OverrideKey,
  value: z.boolean()
})

const ObserverIndexEntry = z.object({
  eventId: requiredString('Missing event id'),
  channelId: z.string().nullable(),
  createdAt: z.number()
})

const ObserverIndexWrite = z.object({ entries: z.array(ObserverIndexEntry) })

const ObserverIndexCursor = z
  .object({ createdAt: z.number(), id: z.string() })
  .nullable()
  .optional()

const ObserverIndexRead = z.object({
  channelId: requiredString('Missing channel id'),
  before: ObserverIndexCursor,
  limit: OptionalPositiveInt
})

function toIndexEntries(entries: z.infer<typeof ObserverIndexWrite>['entries']): ObserverChannelIndexEntry[] {
  return entries.map((entry) => ({
    eventId: entry.eventId,
    channelId: entry.channelId,
    createdAt: entry.createdAt
  }))
}

const RunId = z.object({ runId: requiredString('Missing run id') })

const ApprovalToken = z.object({
  token: requiredString('Missing approval token'),
  note: OptionalPlainString
})

const DecryptObserverEvent = z.object({
  eventJson: requiredString('Missing observer event')
})

const BuildObserverControlEvent = z.object({
  agentPubkey: requiredString('Missing agent pubkey'),
  payload: z.unknown()
})

export const COMMUNICATIONS_AGENT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'agentObserver.decryptEvent',
    params: DecryptObserverEvent,
    handler: (params) => ({ payload: decryptObserverEvent(params.eventJson) })
  }),
  defineMethod({
    name: 'agentObserver.buildControlEvent',
    params: BuildObserverControlEvent,
    handler: (params) => ({ eventJson: buildObserverControlEvent(params.agentPubkey, params.payload) })
  }),
  defineMethod({
    name: 'agentHarness.save',
    params: SaveHarness,
    handler: (params) => ({
      harness: saveCustomHarness(toHarnessDefinition(params.definition), params.originalId ?? null)
    })
  }),
  defineMethod({
    name: 'agentHarness.delete',
    params: HarnessId,
    handler: (params) => {
      deleteCustomHarness(params.id)
      return { removed: true, id: params.id }
    }
  }),
  defineMethod({
    name: 'agentConfig.get',
    params: null,
    handler: () => ({ config: getGlobalAgentConfig() })
  }),
  defineMethod({
    name: 'agentConfig.set',
    params: GlobalAgentConfigInput,
    handler: (params) => ({
      config: setGlobalAgentConfig(toGlobalAgentConfig(params)),
      // Why: Dobius agents are on-demand SDK queries, not resident processes —
      // there is nothing running in the background to stop and respawn when
      // the global defaults change, so both counts are honestly zero rather
      // than a fabricated restart count.
      restarted_count: 0,
      failed_restart_count: 0
    })
  }),
  defineMethod({
    name: 'agentManagedProfiles.get',
    params: null,
    handler: () => ({ enabled: getAgentManagedProfiles() })
  }),
  defineMethod({
    name: 'agentManagedProfiles.set',
    params: AgentManagedProfiles,
    handler: (params) => ({ enabled: setAgentManagedProfiles(params.enabled) })
  }),
  defineMethod({
    name: 'agentLocalOverrides.get',
    params: AgentLocalOverrideGet,
    handler: (params) => ({ overrides: getAgentLocalOverrides(params.agentId) })
  }),
  defineMethod({
    name: 'agentLocalOverrides.set',
    params: AgentLocalOverrideSet,
    handler: (params) => ({
      overrides: setAgentLocalOverride(params.agentId, params.key, params.value)
    })
  }),
  defineMethod({
    name: 'agentObserverIndex.write',
    params: ObserverIndexWrite,
    handler: (params) => {
      indexObserverChannelIds(toIndexEntries(params.entries))
      return { indexed: params.entries.length }
    }
  }),
  defineMethod({
    name: 'agentObserverIndex.readForChannel',
    params: ObserverIndexRead,
    handler: (params) => ({
      entries: readIndexedEventsForChannel(params.channelId, {
        before: params.before ?? undefined,
        limit: params.limit
      })
    })
  }),
  defineMethod({
    name: 'agentApprovals.listForRun',
    params: RunId,
    handler: (params) => ({ approvals: listApprovalsForRun(params.runId) })
  }),
  defineMethod({
    name: 'agentApprovals.grant',
    params: ApprovalToken,
    handler: async (params) => ({ approval: await grantAgentApproval(params.token) })
  }),
  defineMethod({
    name: 'agentApprovals.deny',
    params: ApprovalToken,
    handler: async (params) => ({
      approval: await denyAgentApproval(params.token, params.note ?? null)
    })
  })
]
