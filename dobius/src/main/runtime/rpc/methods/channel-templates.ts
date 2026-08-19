import { z } from 'zod'
import {
  createChannelTemplate,
  duplicateChannelTemplate,
  getChannelTemplate,
  listChannelTemplates,
  removeChannelTemplate,
  updateChannelTemplate
} from '../../../communications/canvas/channel-template-store'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalPlainString, requiredString } from '../schemas'

// Why: this file is NOT wired into methods/index.ts's ALL_RPC_METHODS by
// this change — index.ts is a shared aggregator many parallel feature
// agents touch (see teams.ts's own registration for the pattern to splice
// in: one import line + one `...CHANNEL_TEMPLATE_METHODS` spread line).
// Applied centrally alongside this task's other shared-file diffs.

const TemplateBackend = z
  .union([z.object({ type: z.literal('local') }), z.object({ type: z.literal('provider'), id: z.string() })])
  .nullable()
  .optional()

const TemplateAgentEntry = z.object({
  personaId: z.string().optional(),
  runtime: OptionalPlainString,
  model: OptionalPlainString,
  role: OptionalPlainString,
  backend: TemplateBackend
})

const TemplateTeamEntry = z.object({
  teamId: z.string().optional(),
  runtime: OptionalPlainString,
  model: OptionalPlainString,
  backend: TemplateBackend
})

const TemplateAgents = z
  .object({
    personas: z.array(TemplateAgentEntry).optional(),
    teams: z.array(TemplateTeamEntry).optional()
  })
  .optional()

const ChannelTemplateId = z.object({
  id: requiredString('Missing channel template id')
})

const ChannelTemplateCreate = z.object({
  name: requiredString('Missing channel template name'),
  description: OptionalPlainString,
  channelType: OptionalPlainString,
  visibility: OptionalPlainString,
  canvasTemplate: OptionalPlainString,
  agents: TemplateAgents
})

const ChannelTemplateUpdateFields = z.object({
  name: OptionalString(),
  description: OptionalPlainString,
  channelType: OptionalPlainString,
  visibility: OptionalPlainString,
  canvasTemplate: OptionalPlainString,
  agents: TemplateAgents
})

// Why a local helper instead of importing schemas.ts's OptionalString: that
// export is a value (a built schema), not a factory — this file needs a
// fresh optional-nonempty-string schema for one field, so a tiny local
// factory reads clearer than aliasing the shared constant under a new name.
function OptionalString() {
  return z
    .unknown()
    .transform((value) => (typeof value === 'string' && value.length > 0 ? value : undefined))
    .pipe(z.union([z.string(), z.undefined()]))
    .optional()
}

const ChannelTemplateUpdate = z.object({
  id: requiredString('Missing channel template id'),
  updates: ChannelTemplateUpdateFields
})

function showChannelTemplate(id: string) {
  const template = getChannelTemplate(id)
  if (!template) {
    throw new Error(`Channel template not found: ${id}`)
  }
  return template
}

export const CHANNEL_TEMPLATE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'channelTemplate.list',
    params: null,
    handler: () => ({ templates: listChannelTemplates() })
  }),
  defineMethod({
    name: 'channelTemplate.show',
    params: ChannelTemplateId,
    handler: (params) => ({ template: showChannelTemplate(params.id) })
  }),
  defineMethod({
    name: 'channelTemplate.create',
    params: ChannelTemplateCreate,
    handler: (params) => {
      const templates = createChannelTemplate(params)
      // Why .at(-1): createChannelTemplate appends and returns the full
      // roster, so the last entry is the one just created — same
      // convention as team.create's handler.
      return { template: templates.at(-1) }
    }
  }),
  defineMethod({
    name: 'channelTemplate.update',
    params: ChannelTemplateUpdate,
    handler: (params) => {
      const templates = updateChannelTemplate(params.id, params.updates)
      return { template: templates.find((template) => template.id === params.id) }
    }
  }),
  defineMethod({
    name: 'channelTemplate.delete',
    params: ChannelTemplateId,
    handler: (params) => {
      showChannelTemplate(params.id)
      removeChannelTemplate(params.id)
      return { removed: true, id: params.id }
    }
  }),
  defineMethod({
    name: 'channelTemplate.duplicate',
    params: ChannelTemplateId,
    handler: (params) => {
      showChannelTemplate(params.id)
      const templates = duplicateChannelTemplate(params.id)
      return { template: templates.at(-1) }
    }
  })
]
