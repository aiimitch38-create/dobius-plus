import { z } from 'zod'
import { EngineeredPromptSchema } from '../terminals/prompt.js'

export const WorkerPreflightRequestSchema = z.object({
  senderId: z.literal('carson'),
  repoSelector: z.string().min(1),
  needsCurrentUncommittedState: z.boolean().default(false),
  fullHandoff: z.boolean().default(false),
  reviewOnly: z.boolean().default(false)
})

export const WorkerLaunchRequestSchema = z.object({
  senderId: z.literal('carson'),
  dedupeKey: z.string().min(1).max(256),
  repoSelector: z.string().min(1),
  worktreeName: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  agentType: z.enum(['codex', 'claude']),
  setupPolicy: z.enum(['run', 'skip', 'inherit']).default('inherit'),
  fullHandoff: z.boolean().default(false),
  prompt: EngineeredPromptSchema.omit({ targetContext: true }),
  authorization: z.object({
    authorizedBy: z.literal('carson'), approved: z.literal(true),
    source: z.enum(['api', 'imessage', 'desktop', 'voice'])
  })
})
