import path from 'node:path'
import { parseEveryValue, SafeJsonFile } from '../../storage/safe-json-file'
import { getUserDataRoot } from '../../storage/user-data-root'

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

function filePath(): string {
  return path.join(getUserDataRoot(), FILE_NAME)
}

// Why: a malformed entry makes the whole file unreadable instead of being
// dropped and then saved over (CX12 F2).
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

const file = new SafeJsonFile<HarnessFile>({
  filePath,
  parse: (raw) => parseEveryValue(raw, sanitizeDefinition),
  fallback: () => ({}),
  label: `[communications/agents] ${FILE_NAME}`
})

function load(): HarnessFile {
  return file.get()
}

// Throws like the old writer did, so the RPC caller sees that nothing was saved.
function persist(data: HarnessFile): void {
  if (!file.set(data)) {
    throw new Error('Custom harnesses could not be saved')
  }
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
  persist(data)
  return definition
}

export function deleteCustomHarness(id: string): void {
  const data = load()
  if (!(id in data)) {
    return
  }
  delete data[id]
  persist(data)
}
