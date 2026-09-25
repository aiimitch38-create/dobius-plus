/**
 * Persistence for Buzz workflow definitions (create_workflow/update_workflow/
 * delete_workflow/get_workflow/get_channel_workflows/get_channels_workflows —
 * vendor/buzz-desktop/src/shared/api/tauriWorkflows.ts). Mirrors
 * team-store.ts's shape exactly: SafeJsonFile (atomic write, module-level
 * cache). A hand-edited or corrupted file is unreadable: it is kept on disk
 * and saves are refused, rather than a bad record being dropped and saved over.
 *
 * A Workflow here is the Dobius-native record; workflow-rpc-methods.ts is
 * the RPC boundary, and the paste-ready dobiusCommunications.ts case blocks
 * (see the build report) are what map this camelCase shape to Buzz's
 * snake_case RawWorkflow — same layering team-store.ts / teamFromRecord use.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import { app } from 'electron'
import { parseEveryEntry, SafeJsonFile } from '../../storage/safe-json-file'
import {
  parseWorkflowYaml,
  type WorkflowStatus,
  type WorkflowStep,
  isWorkflowStatus
} from './workflow-yaml'

const FILE_NAME = 'workflows.json'

export type Workflow = {
  id: string
  name: string
  ownerPubkey: string
  channelId: string | null
  /** Source YAML text, round-tripped by update_workflow. */
  definitionYaml: string
  /** Parsed YAML mapping, returned to the UI as `definition`. */
  definition: Record<string, unknown>
  /** Structurally-validated steps parsed out of `definition.steps`. */
  steps: WorkflowStep[]
  status: WorkflowStatus
  /** Generated once at creation; stable across updates (not rotated). */
  webhookSecret: string
  createdAt: number
  updatedAt: number
}

export type WorkflowCreateInput = {
  ownerPubkey: string
  channelId: string | null
  yamlDefinition: string
}

export type WorkflowUpdateInput = {
  yamlDefinition: string
}

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function cloneWorkflow(workflow: Workflow): Workflow {
  return {
    ...workflow,
    definition: { ...workflow.definition },
    steps: workflow.steps.map((step) => ({ ...step, with: { ...step.with } }))
  }
}

// Why: a malformed or no-longer-parsable record makes the whole file
// unreadable instead of being dropped and then saved over (CX12 F2).
function sanitizeWorkflow(entry: unknown): Workflow | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }
  const record = entry as Partial<Record<keyof Workflow, unknown>>
  const id = typeof record.id === 'string' ? record.id : ''
  const ownerPubkey = typeof record.ownerPubkey === 'string' ? record.ownerPubkey : ''
  const definitionYaml = typeof record.definitionYaml === 'string' ? record.definitionYaml : ''
  if (!id || !ownerPubkey || !definitionYaml) {
    return null
  }
  const parsed = parseWorkflowYaml(definitionYaml)
  if (!parsed.ok) {
    // Why: never served with stale/fabricated steps. Refusing the whole
    // file (not dropping this record) keeps the hand-edited YAML on disk.
    return null
  }
  return {
    id,
    name:
      typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : (parsed.definition.name ?? 'Untitled Workflow'),
    ownerPubkey,
    channelId: typeof record.channelId === 'string' && record.channelId ? record.channelId : null,
    definitionYaml,
    definition: parsed.definition.raw,
    steps: parsed.definition.steps,
    status: isWorkflowStatus(record.status) ? record.status : 'active',
    webhookSecret:
      typeof record.webhookSecret === 'string' && record.webhookSecret
        ? record.webhookSecret
        : randomBytes(24).toString('hex'),
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
  }
}

const file = new SafeJsonFile<Workflow[]>({
  filePath,
  parse: (raw) => (Array.isArray(raw) ? parseEveryEntry(raw, sanitizeWorkflow) : undefined),
  fallback: () => [],
  label: `[workflows] ${FILE_NAME}`
})

function load(): Workflow[] {
  return file.get()
}

// Why: throws so the renderer's error path shows a refused save instead of
// an edit that silently disappears on restart.
function persist(workflows: Workflow[]): void {
  file.save(workflows)
}

export function listAllWorkflows(): Workflow[] {
  return load().map(cloneWorkflow)
}

export function listWorkflowsByChannel(channelId: string): Workflow[] {
  return load()
    .filter((workflow) => workflow.channelId === channelId)
    .map(cloneWorkflow)
}

export function listWorkflowsByChannels(channelIds: string[]): Workflow[] {
  const wanted = new Set(channelIds)
  return load()
    .filter((workflow) => workflow.channelId !== null && wanted.has(workflow.channelId))
    .map(cloneWorkflow)
}

export function getWorkflow(id: string): Workflow | null {
  const workflow = load().find((entry) => entry.id === id)
  return workflow ? cloneWorkflow(workflow) : null
}

export function createWorkflow(input: WorkflowCreateInput): Workflow {
  const parsed = parseWorkflowYaml(input.yamlDefinition)
  if (!parsed.ok) {
    throw new Error(parsed.reason)
  }
  if (!input.ownerPubkey.trim()) {
    throw new Error('Missing workflow owner')
  }
  const now = Date.now()
  const workflows = load()
  const workflow: Workflow = {
    id: randomUUID(),
    name: parsed.definition.name ?? 'Untitled Workflow',
    ownerPubkey: input.ownerPubkey.trim(),
    channelId: input.channelId?.trim() || null,
    definitionYaml: input.yamlDefinition,
    definition: parsed.definition.raw,
    steps: parsed.definition.steps,
    status: parsed.definition.status ?? 'active',
    webhookSecret: randomBytes(24).toString('hex'),
    createdAt: now,
    updatedAt: now
  }
  workflows.push(workflow)
  persist(workflows)
  return cloneWorkflow(workflow)
}

export function updateWorkflow(id: string, input: WorkflowUpdateInput): Workflow {
  const parsed = parseWorkflowYaml(input.yamlDefinition)
  if (!parsed.ok) {
    throw new Error(parsed.reason)
  }
  const workflows = load()
  const workflow = workflows.find((entry) => entry.id === id)
  if (!workflow) {
    throw new Error('Workflow not found')
  }
  workflow.name = parsed.definition.name ?? workflow.name
  workflow.definitionYaml = input.yamlDefinition
  workflow.definition = parsed.definition.raw
  workflow.steps = parsed.definition.steps
  workflow.status = parsed.definition.status ?? workflow.status
  workflow.updatedAt = Date.now()
  persist(workflows)
  return cloneWorkflow(workflow)
}

export function removeWorkflow(id: string): void {
  const before = load()
  const after = before.filter((workflow) => workflow.id !== id)
  if (after.length === before.length) {
    throw new Error('Workflow not found')
  }
  persist(after)
}
