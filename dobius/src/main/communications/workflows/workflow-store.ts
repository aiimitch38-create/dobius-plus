/**
 * Persistence for Buzz workflow definitions (create_workflow/update_workflow/
 * delete_workflow/get_workflow/get_channel_workflows/get_channels_workflows —
 * vendor/buzz-desktop/src/shared/api/tauriWorkflows.ts). Mirrors
 * team-store.ts's shape exactly: atomic tmp-then-rename write, module-level
 * cache, honest sanitize-on-load so a hand-edited or corrupted file degrades
 * to "drop the bad record" rather than throwing.
 *
 * A Workflow here is the Dobius-native record; workflow-rpc-methods.ts is
 * the RPC boundary, and the paste-ready dobiusCommunications.ts case blocks
 * (see the build report) are what map this camelCase shape to Buzz's
 * snake_case RawWorkflow — same layering team-store.ts / teamFromRecord use.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
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

let cached: Workflow[] | null = null

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

function sanitize(raw: unknown): Workflow[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const record = entry as Partial<Record<keyof Workflow, unknown>>
    const id = typeof record.id === 'string' ? record.id : ''
    const ownerPubkey = typeof record.ownerPubkey === 'string' ? record.ownerPubkey : ''
    const definitionYaml = typeof record.definitionYaml === 'string' ? record.definitionYaml : ''
    if (!id || !ownerPubkey || !definitionYaml) {
      return []
    }
    const parsed = parseWorkflowYaml(definitionYaml)
    if (!parsed.ok) {
      // Why: a workflow that once parsed but was hand-edited into invalid
      // YAML on disk is dropped rather than served with stale/fabricated
      // steps — same "corrupt record is discarded, not guessed at" contract
      // as team-store.ts's sanitize().
      return []
    }
    return [
      {
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
    ]
  })
}

function load(): Workflow[] {
  if (cached) {
    return cached
  }
  try {
    cached = sanitize(JSON.parse(readFileSync(filePath(), 'utf-8')))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      console.warn(
        '[workflows] failed to load workflows:',
        error instanceof Error ? error.message : String(error)
      )
    }
    cached = []
  }
  return cached
}

function persist(workflows: Workflow[]): void {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(workflows, null, 2)}\n`, 'utf-8')
    renameSync(tmp, target)
  } catch (error) {
    console.warn(
      '[workflows] failed to persist workflows:',
      error instanceof Error ? error.message : String(error)
    )
  }
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
  cached = workflows
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
  cached = workflows
  persist(workflows)
  return cloneWorkflow(workflow)
}

export function removeWorkflow(id: string): void {
  const before = load()
  const after = before.filter((workflow) => workflow.id !== id)
  if (after.length === before.length) {
    throw new Error('Workflow not found')
  }
  cached = after
  persist(after)
}
