/**
 * RPC methods backing the workflow.* commands (create_workflow et al —
 * vendor/buzz-desktop/src/shared/api/tauriWorkflows.ts). Follows the same
 * `defineMethod`/zod-schema shape as src/main/runtime/rpc/methods/teams.ts.
 *
 * WIRING (not applied by this file — see the build report's SWITCH_CASES /
 * ALLOWLIST sections): the coordinator adds one import + one array-spread
 * line to src/main/runtime/rpc/methods/index.ts (`...WORKFLOW_METHODS`,
 * mirroring every other family in that file) and one entry per method name
 * below to COMMUNICATIONS_RUNTIME_METHODS in
 * src/shared/communications-bridge.ts. Both are shared files this feature
 * does not own, per the multi-agent build split.
 */
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../../runtime/rpc/core'
import { OptionalPositiveInt, requiredString } from '../../runtime/rpc/schemas'
import {
  createWorkflow,
  deleteWorkflow,
  getChannelWorkflows,
  getChannelsWorkflows,
  getWorkflowOrThrow,
  getWorkflowRuns,
  triggerWorkflow,
  updateWorkflow
} from './workflow-service'

const ChannelId = z.object({
  channelId: requiredString('Missing channel id')
})

const ChannelIds = z.object({
  channelIds: z.array(z.string()).min(1, 'Missing channel ids')
})

const WorkflowId = z.object({
  workflowId: requiredString('Missing workflow id')
})

const WorkflowCreate = z.object({
  ownerPubkey: requiredString('Missing workflow owner'),
  channelId: z
    .unknown()
    .transform((value) => (typeof value === 'string' && value.trim() ? value.trim() : null))
    .pipe(z.union([z.string(), z.null()])),
  yamlDefinition: requiredString('Missing workflow definition')
})

const WorkflowUpdate = z.object({
  workflowId: requiredString('Missing workflow id'),
  yamlDefinition: requiredString('Missing workflow definition')
})

const WorkflowRunsQuery = z.object({
  workflowId: requiredString('Missing workflow id'),
  limit: OptionalPositiveInt
})

export const WORKFLOW_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'workflow.listByChannel',
    params: ChannelId,
    handler: (params) => ({ workflows: getChannelWorkflows(params.channelId) })
  }),
  defineMethod({
    name: 'workflow.listByChannels',
    params: ChannelIds,
    handler: (params) => ({ workflows: getChannelsWorkflows(params.channelIds) })
  }),
  defineMethod({
    name: 'workflow.show',
    params: WorkflowId,
    handler: (params) => ({ workflow: getWorkflowOrThrow(params.workflowId) })
  }),
  defineMethod({
    name: 'workflow.create',
    params: WorkflowCreate,
    handler: (params) => ({
      workflow: createWorkflow({
        ownerPubkey: params.ownerPubkey,
        channelId: params.channelId,
        yamlDefinition: params.yamlDefinition
      })
    })
  }),
  defineMethod({
    name: 'workflow.update',
    params: WorkflowUpdate,
    handler: (params) => ({
      workflow: updateWorkflow(params.workflowId, { yamlDefinition: params.yamlDefinition })
    })
  }),
  defineMethod({
    name: 'workflow.delete',
    params: WorkflowId,
    handler: (params) => {
      deleteWorkflow(params.workflowId)
      return { removed: true, workflowId: params.workflowId }
    }
  }),
  defineMethod({
    name: 'workflow.trigger',
    params: WorkflowId,
    handler: (params) => triggerWorkflow(params.workflowId)
  }),
  defineMethod({
    name: 'workflow.runs',
    params: WorkflowRunsQuery,
    handler: (params) => ({ runs: getWorkflowRuns(params.workflowId, params.limit) })
  })
]
