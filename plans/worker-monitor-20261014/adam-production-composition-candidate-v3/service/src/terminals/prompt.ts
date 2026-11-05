import { z } from 'zod'
import { compilePrompt, type PromptProfile } from '../prompts/compiler.js'

export const EngineeredPromptSchema = z.object({
  mode: z.literal('engineered'),
  profileId: z.string().min(1),
  roleContext: z.string().min(1),
  originalRequest: z.string().min(1),
  targetContext: z.object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    worktreePath: z.string().min(1),
    branch: z.string().optional()
  }),
  readFirst: z.array(z.string().min(1)).default([]),
  algorithmLedger: z.array(z.object({
    requirement: z.string().min(1), owner: z.string().min(1),
    verdict: z.enum(['KEEP', 'KILL', 'SIMPLIFY']), observableImpact: z.string().min(1)
  })).min(1),
  task: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  additionalGuardrails: z.array(z.string().min(1)).default([]),
  authority: z.object({
    allowed: z.array(z.string().min(1)), prohibited: z.array(z.string().min(1)),
    approvalRequired: z.array(z.string().min(1))
  }),
  definitionOfDone: z.object({ id: z.string().min(1), verifiers: z.array(z.string().min(1)).min(1) }),
  expectedSignals: z.array(z.string().min(1)).default([]),
  escalationConditions: z.array(z.string().min(1)).default([]),
  returnFormat: z.string().min(1),
  failSafe: z.string().min(1)
})

const LiteralPromptSchema = z.object({
  mode: z.literal('literal'),
  text: z.string().min(1).max(32_000)
})

export const TerminalDispatchRequestSchema = z.object({
  senderId: z.literal('carson'),
  dedupeKey: z.string().min(1).max(256),
  target: z.object({
    terminalHandle: z.string().startsWith('term_'),
    worktreeId: z.string().min(1)
  }),
  prompt: z.discriminatedUnion('mode', [LiteralPromptSchema, EngineeredPromptSchema]),
  authorization: z.object({
    authorizedBy: z.literal('carson'),
    approved: z.literal(true),
    source: z.enum(['api', 'imessage', 'desktop', 'voice'])
  }),
  allowInterrupt: z.boolean().default(false)
})

export type TerminalDispatchRequest = z.infer<typeof TerminalDispatchRequestSchema>

export function renderPrompt(
  input: TerminalDispatchRequest['prompt'],
  target: TerminalDispatchRequest['target'],
  profile?: PromptProfile
): string {
  if (input.mode === 'literal') return input.text
  if (!profile) throw new Error(`Prompt profile is unavailable: ${input.profileId}`)
  return compilePrompt({
    ...input,
    target: {
      projectId: input.targetContext.projectId,
      projectName: input.targetContext.projectName,
      worktreePath: input.targetContext.worktreePath,
      ...(input.targetContext.branch ? { branch: input.targetContext.branch } : {}),
      worktreeId: target.worktreeId,
      terminalHandle: target.terminalHandle
    }
  }, profile)
}
