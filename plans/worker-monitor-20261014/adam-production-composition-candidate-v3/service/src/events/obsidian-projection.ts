import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DobiusEvent } from './ingest.js'

let writeTail = Promise.resolve()

function vaultPath(): string | undefined {
  return process.env.ADAM_OBSIDIAN_VAULT_PATH || join(homedir(), 'Obsidian Vault')
}

function activityPath(event: DobiusEvent, vault: string): string {
  const date = event.occurredAt.slice(0, 10)
  return join(vault, 'AI Research', 'Dobius Agent Activity', `${date}.md`)
}

function render(event: DobiusEvent): string {
  const context = event.context
  const links = [
    context?.projectId ? `project=${context.projectId}` : null,
    context?.adamJobId ? `job=${context.adamJobId}` : null,
    context?.adamTaskId ? `task=${context.adamTaskId}` : null,
    `run=${event.runId}`,
    `agent=${event.agentId}`
  ].filter((value): value is string => Boolean(value))
  return `- ${event.occurredAt} **${event.eventType}** (${links.join(', ')}) — ${JSON.stringify(event.payload)}\n`
}

export function queueObsidianProjection(event: DobiusEvent): boolean {
  const vault = vaultPath()
  if (!vault) return false
  const target = activityPath(event, vault)
  const line = render(event)
  writeTail = writeTail
    .then(async () => {
      await mkdir(join(vault, 'AI Research', 'Dobius Agent Activity'), { recursive: true })
      await appendFile(target, line, 'utf8')
    })
    .catch((error) => {
      console.warn('[adam] failed to project event to Obsidian:', error instanceof Error ? error.message : String(error))
    })
  return true
}
