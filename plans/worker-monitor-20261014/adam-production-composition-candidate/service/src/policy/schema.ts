import { z } from 'zod'

export const PolicyDecisionSchema = z.enum(['allow', 'require_approval', 'deny'])
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>

export const ActionSchema = z.object({
  category: z.string().min(1),
  accountId: z.string().min(1).optional(),
  recipientId: z.string().min(1).optional(),
  purpose: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  content: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})
export type Action = z.infer<typeof ActionSchema>

const RuleMatchSchema = z
  .object({
    accountId: z.string().optional(),
    recipientId: z.string().optional(),
    purpose: z.string().optional(),
    projectId: z.string().optional(),
    target: z.string().optional()
  })
  .strict()

const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  decision: PolicyDecisionSchema,
  categories: z.array(z.string().min(1)).min(1),
  match: RuleMatchSchema.optional()
})

export const AuthorityConfigSchema = z.object({
  version: z.literal(1),
  approvedBy: z.string().min(1),
  approvedAt: z.coerce.date(),
  defaultDecision: PolicyDecisionSchema,
  approval: z.object({
    defaultTtlMinutes: z.number().int().positive(),
    consumeOnce: z.boolean()
  }),
  modes: z.object({
    normal: z.literal('normal'),
    readOnly: z.literal('read_only'),
    frozen: z.literal('frozen')
  }),
  rules: z.array(PolicyRuleSchema).min(1)
})
export type AuthorityConfig = z.infer<typeof AuthorityConfigSchema>

export const RuntimeModeSchema = z.enum(['normal', 'read_only', 'frozen'])
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>

export type Evaluation = {
  decision: PolicyDecision
  ruleId: string
  explanation: string
  actionDigest: string
}
