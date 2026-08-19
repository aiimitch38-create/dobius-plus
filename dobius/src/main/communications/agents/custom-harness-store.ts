import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const FILE_NAME = 'communications-custom-harnesses.json'

// Why: Buzz's Settings > Harness Catalog lets a user define an arbitrary
// external ACP-speaking CLI command. Dobius's agent runner (agent-runner.ts)
// only ever launches the bundled Claude Agent SDK or the Codex CLI — there is
// no code path that spawns an arbitrary user-supplied command as an agent.
// Definitions saved here are real, persisted CRUD records so the catalog UI
// keeps working, but nothing in Dobius currently executes them; see the
// PER_COMMAND / RISKS notes in the handoff report.
export type CustomHarnessDefinition = {
  id: string
  label: string
  command: string
  args: string[]
  env: Record<string, string>
  installInstructionsUrl: string
  installHint: string
}

type HarnessFile = Record<string, CustomHarnessDefinition>

let cached: HarnessFile | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function sanitizeDefinition(raw: unknown): CustomHarnessDefinition | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const record = raw as Partial<Record<keyof CustomHarnessDefinition, unknown>>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  const command = typeof record.command === 'string' ? record.command.trim() : ''
  if (!id || !label || !command) {
    return null
  }
  return {
    id,
    label,
    command,
    args: Array.isArray(record.args) ? record.args.filter((a): a is string => typeof a === 'string') : [],
    env:
      typeof record.env === 'object' && record.env !== null && !Array.isArray(record.env)
        ? Object.fromEntries(
            Object.entries(record.env as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
        : {},
    installInstructionsUrl:
      typeof record.installInstructionsUrl === 'string' ? record.installInstructionsUrl : '',
    installHint: typeof record.installHint === 'string' ? record.installHint : ''
  }
}

function sanitize(raw: unknown): HarnessFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {}
  }
  const out: HarnessFile = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const definition = sanitizeDefinition(value)
    if (definition) {
      out[id] = definition
    }
  }
  return out
}

function load(): HarnessFile {
  if (cached) {
    return cached
  }
  const target = filePath()
  if (!existsSync(target)) {
    cached = {}
    return cached
  }
  try {
    cached = sanitize(JSON.parse(readFileSync(target, 'utf-8')))
  } catch (error) {
    console.warn(
      '[communications/agents] failed to load custom harnesses:',
      error instanceof Error ? error.message : String(error)
    )
    cached = {}
  }
  return cached
}

function persist(data: HarnessFile): void {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  renameSync(tmp, target)
}

export function listCustomHarnesses(): CustomHarnessDefinition[] {
  return Object.values(load())
}

export function saveCustomHarness(
  definition: CustomHarnessDefinition,
  originalId?: string | null
): CustomHarnessDefinition {
  if (!definition.id.trim() || !definition.label.trim() || !definition.command.trim()) {
    throw new Error('A custom harness needs an id, label, and command')
  }
  const data = load()
  if (originalId && originalId !== definition.id) {
    delete data[originalId]
  }
  data[definition.id] = definition
  cached = data
  persist(data)
  return definition
}

export function deleteCustomHarness(id: string): void {
  const data = load()
  if (!(id in data)) {
    return
  }
  delete data[id]
  cached = data
  persist(data)
}
