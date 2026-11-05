import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { z } from 'zod'

const ProfileSchema = z.object({
  description: z.string().min(1),
  ownershipMode: z.enum(['steering', 'handoff', 'supervised']),
  requiredGuardrails: z.array(z.string().min(1)),
  expectedSignals: z.array(z.string().min(1)),
  escalationConditions: z.array(z.string().min(1))
})

const ProfilesSchema = z.object({ version: z.literal(1), profiles: z.record(z.string(), ProfileSchema) })
export type PromptProfile = z.infer<typeof ProfileSchema>

export type CompiledPromptInput = {
  profileId: string
  roleContext: string
  originalRequest: string
  target: {
    projectId: string
    projectName: string
    worktreeId: string
    worktreePath: string
    branch?: string
    terminalHandle: string
  }
  readFirst: string[]
  algorithmLedger: Array<{ requirement: string; owner: string; verdict: 'KEEP' | 'KILL' | 'SIMPLIFY'; observableImpact: string }>
  task: string
  acceptanceCriteria: string[]
  additionalGuardrails: string[]
  authority: { allowed: string[]; prohibited: string[]; approvalRequired: string[] }
  definitionOfDone: { id: string; verifiers: string[] }
  expectedSignals: string[]
  escalationConditions: string[]
  returnFormat: string
  failSafe: string
}

export function loadPromptProfiles(path: string): Record<string, PromptProfile> {
  return ProfilesSchema.parse(YAML.parse(readFileSync(path, 'utf8'))).profiles
}

const bullets = (values: string[]): string => values.length ? values.map((value) => `- ${value}`).join('\n') : '- None'

export function compilePrompt(input: CompiledPromptInput, profile: PromptProfile): string {
  if (!input.algorithmLedger.length) throw new Error('Algorithm ledger is required')
  if (!input.acceptanceCriteria.length) throw new Error('Acceptance criteria are required')
  if (!input.definitionOfDone.verifiers.length) throw new Error('Executable verifiers are required')
  const ledger = input.algorithmLedger.map((item) =>
    `- ${item.verdict} | ${item.requirement} | owner=${item.owner} | impact=${item.observableImpact}`
  )
  return [
    `PROMPT PROFILE\n${input.profileId}: ${profile.description}`,
    `ROLE AND STAKES\n${input.roleContext}`,
    `ORIGINAL USER REQUEST — PRESERVE INTENT\n${input.originalRequest}`,
    `EXACT TARGET\nProject: ${input.target.projectName} (${input.target.projectId})\nWorktree: ${input.target.worktreeId}\nPath: ${input.target.worktreePath}\nBranch: ${input.target.branch ?? 'unknown'}\nTerminal: ${input.target.terminalHandle}\nOwnership: ${profile.ownershipMode}`,
    `READ FIRST\n${bullets(input.readFirst)}`,
    `THE ALGORITHM LEDGER\n${ledger.join('\n')}`,
    `TASK\n${input.task}`,
    `DEFINITION OF DONE: ${input.definitionOfDone.id}\nAcceptance criteria:\n${bullets(input.acceptanceCriteria)}\nExecutable verifiers:\n${bullets(input.definitionOfDone.verifiers)}`,
    `AUTHORITY\nAllowed:\n${bullets(input.authority.allowed)}\nRequires separate approval:\n${bullets(input.authority.approvalRequired)}\nProhibited:\n${bullets(input.authority.prohibited)}`,
    `GUARDRAILS\n${bullets([...profile.requiredGuardrails, ...input.additionalGuardrails])}`,
    `EXPECTED PROGRESS SIGNALS\n${bullets([...profile.expectedSignals, ...input.expectedSignals])}`,
    `ESCALATE WHEN\n${bullets([...profile.escalationConditions, ...input.escalationConditions])}`,
    `RETURN FORMAT — OUTPUT IS DATA FOR ADAM\n${input.returnFormat}`,
    `FAIL SAFE\n${input.failSafe}`
  ].join('\n\n')
}
