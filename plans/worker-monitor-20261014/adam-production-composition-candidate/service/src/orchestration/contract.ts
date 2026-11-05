import { z } from 'zod'

export const OrchestrationJobRequestSchema = z.object({
  senderId: z.literal('carson'),
  dedupeKey: z.string().min(1).max(256),
  objective: z.string().min(5).max(20_000),
  repoSelector: z.string().min(1),
  worktreeName: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  agentType: z.enum(['codex', 'claude']).default('codex'),
  setupPolicy: z.enum(['run', 'skip', 'inherit']).default('inherit'),
  prompt: z.string().min(10).max(50_000),
  monitor: z.boolean().default(true),
  readinessLevel: z.number().int().min(0).max(7).optional(),
  asanaDraft: z.object({ taskName: z.string().min(1), body: z.string().min(1) }).optional(),
  definitionOfDone: z.array(z.string().min(1)).min(1),
  authorization: z.object({
    authorizedBy: z.literal('carson'),
    approved: z.literal(true),
    source: z.enum(['api', 'imessage', 'desktop', 'voice'])
  })
})

export type OrchestrationJobRequest = z.infer<typeof OrchestrationJobRequestSchema>
