import type { CloudBackupStatus } from '../../shared/cloud-backup'
import type { ImessageBridgeStatus } from '../../shared/imessage-bridge'
import type { KnowledgeReadResult, KnowledgeTree } from '../../shared/knowledge'
import type { ProviderRateLimits, RateLimitState, RateLimitWindow } from '../../shared/rate-limit-types'
import type { UpdateStatus } from '../../shared/types'
import type { CommandHandler } from '../dispatch'
import {
  getBooleanFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

function noteWaitingForConfirmation(json: boolean): void {
  if (!json) {
    process.stderr.write('Waiting up to 25 seconds for you to confirm in the Dobius+ app...\n')
  }
}

function oneOf<T extends string>(
  flags: Map<string, string | boolean>,
  name: string,
  allowed: readonly T[]
): T | undefined {
  const value = getOptionalStringFlag(flags, name)
  if (value === undefined) {
    if (flags.has(name)) {
      throw new RuntimeClientError('invalid_argument', `--${name} needs a value`)
    }
    return undefined
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw new RuntimeClientError('invalid_argument', `--${name} must be ${allowed.join(', ')}`)
  }
  return value as T
}

type UsageResult = {
  provider: string
  scan: { enabled?: boolean; lastScanError?: string | null } | null
  summary: {
    range: string
    scope: string
    sessions: number
    turns: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    estimatedCostUsd: number | null
    topModel: string | null
    topProject: string | null
  }
}

const count = (value: number): string => Math.round(value).toLocaleString('en-US')

export function formatUsage(result: UsageResult): string {
  const s = result.summary
  const lines = [
    `${result.provider} usage, last ${s.range === 'all' ? 'all time' : s.range} (${s.scope === 'dobius' ? 'Dobius+ sessions' : 'all sessions'}):`,
    `  ${count(s.sessions)} sessions, ${count(s.turns)} turns`,
    `  ${count(s.inputTokens)} input tokens, ${count(s.outputTokens)} output tokens, ${count(s.cacheReadTokens)} cache reads`
  ]
  if (s.estimatedCostUsd !== null) {
    lines.push(`  About $${s.estimatedCostUsd.toFixed(2)} at list prices`)
  }
  if (s.topModel) {
    lines.push(`  Most used model: ${s.topModel}`)
  }
  if (s.topProject) {
    lines.push(`  Busiest project: ${s.topProject}`)
  }
  if (result.scan?.enabled === false) {
    lines.push('  Usage tracking is off on the Usage page, so these totals may be empty.')
  }
  if (result.scan?.lastScanError) {
    lines.push(`  Last scan failed: ${result.scan.lastScanError}`)
  }
  return lines.join('\n')
}

function windowLine(label: string, window: RateLimitWindow | null | undefined): string | null {
  if (!window) {
    return null
  }
  const reset = window.resetDescription ? `, resets ${window.resetDescription}` : ''
  return `    ${label}: ${Math.round(window.usedPercent)}% used${reset}`
}

const PROVIDER_NAMES: [keyof RateLimitState, string][] = [
  ['claude', 'Claude'],
  ['codex', 'Codex'],
  ['gemini', 'Gemini'],
  ['opencodeGo', 'OpenCode Go'],
  ['kimi', 'Kimi'],
  ['minimax', 'MiniMax']
]

export function formatLimits(state: RateLimitState): string {
  const lines: string[] = []
  for (const [key, name] of PROVIDER_NAMES) {
    const limits = state[key] as ProviderRateLimits | null
    if (!limits || limits.status === 'unavailable') {
      continue
    }
    lines.push(`${name}${limits.status === 'error' ? ` (could not check: ${limits.error ?? 'error'})` : ''}`)
    for (const line of [
      windowLine('5 hours', limits.session),
      windowLine('7 days', limits.weekly),
      windowLine('7 days (Fable)', limits.fableWeekly),
      windowLine('30 days', limits.monthly)
    ]) {
      if (line) {
        lines.push(line)
      }
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No rate limits known yet. Try `dobius limits --refresh`.'
}

export function formatKnowledgeTree(tree: KnowledgeTree, branch?: string): string {
  const branches = branch ? tree.branches.filter((entry) => entry.id === branch) : tree.branches
  if (branch && branches.length === 0) {
    return `No branch named "${branch}". Branches: ${tree.branches.map((entry) => entry.id).join(', ')}.`
  }
  const lines: string[] = []
  for (const entry of branches) {
    const more = entry.totalCount > entry.leaves.length ? ` (showing ${entry.leaves.length} of ${entry.totalCount})` : ''
    lines.push(`${entry.label} [${entry.id}]: ${entry.sub}${more}`)
    for (const leaf of entry.leaves) {
      lines.push(`  ${leaf.title}  ${leaf.filePath}`)
    }
  }
  return lines.join('\n')
}

export function formatImessage(status: ImessageBridgeStatus): string {
  const lines = [
    status.enabled
      ? status.isRunning
        ? 'iMessage bridge is on and listening.'
        : 'iMessage bridge is on but not running.'
      : 'iMessage bridge is off.',
    `Trigger: "${status.triggerPrefix}"`,
    status.chatDbReadable.ok
      ? 'Messages database: readable.'
      : `Messages database: not readable (${status.chatDbReadable.error ?? 'unknown'}).`,
    `Sent in the last minute: ${status.outboundLastMin}`
  ]
  if (status.unreadableDetail) {
    lines.push(`Settings file problem: ${status.unreadableDetail}`)
  }
  return lines.join('\n')
}

export function formatUpdate(result: { version: string; update: UpdateStatus }): string {
  const { update } = result
  const now = `Dobius+ ${result.version}.`
  switch (update.state) {
    case 'available':
      return `${now} Version ${update.version} is available. Install it from the app.`
    case 'not-available':
      return `${now} It is up to date.`
    case 'checking':
      return `${now} Checking for updates now.`
    case 'disabled':
      return `${now} Updates are turned off for this build.`
    case 'idle':
      return `${now} No update check has finished yet.`
    default:
      return `${now} Update state: ${update.state}.`
  }
}

export function formatBackup(status: CloudBackupStatus): string {
  const lines = [`Backup: ${status.health.replace(/_/g, ' ')}. ${status.detail}`.trim()]
  if (status.configured) {
    lines.push(`Bucket: ${status.bucket} (${status.region}). Schedule ${status.enabled ? 'on' : 'paused'}.`)
  }
  if (status.lastBackupAt) {
    lines.push(`Last backup: ${status.lastBackupAt}`)
  }
  if (status.lastCheckAt) {
    lines.push(`Last restore check: ${status.lastCheckAt}`)
  }
  return lines.join('\n')
}

export const APP_SERVICE_HANDLERS: Record<string, CommandHandler> = {
  usage: async ({ flags, client, json }) => {
    const provider = oneOf(flags, 'provider', ['claude', 'codex', 'opencode'] as const)
    const range = oneOf(flags, 'range', ['7d', '30d', '90d', 'all'] as const)
    const scope = oneOf(flags, 'scope', ['all', 'dobius'] as const)
    const result = await client.call<UsageResult>('usage.summary', {
      ...(provider ? { provider } : {}),
      ...(range ? { range } : {}),
      ...(scope ? { scope } : {})
    })
    printResult(result, json, formatUsage)
  },
  limits: async ({ flags, client, json }) => {
    const refresh = getBooleanFlag(flags, 'refresh')
    const result = await client.call<RateLimitState>(
      'usage.rateLimits',
      refresh ? { refresh: true } : {}
    )
    printResult(result, json, formatLimits)
  },
  'knowledge tree': async ({ flags, client, json }) => {
    const branch = getOptionalStringFlag(flags, 'branch')
    const result = await client.call<KnowledgeTree>('knowledge.tree')
    printResult(result, json, (tree) => formatKnowledgeTree(tree, branch))
  },
  'knowledge read': async ({ flags, client, json }) => {
    const result = await client.call<KnowledgeReadResult>('knowledge.read', {
      path: getRequiredStringFlag(flags, 'path')
    })
    printResult(result, json, (value) => value.content)
  },
  'imessage status': async ({ client, json }) => {
    const result = await client.call<ImessageBridgeStatus>('imessage.status')
    printResult(result, json, formatImessage)
  },
  version: async ({ client, json }) => {
    const result = await client.call<{ version: string }>('app.version')
    printResult(result, json, (value) => `Dobius+ ${value.version}`)
  },
  'update status': async ({ client, json }) => {
    const result = await client.call<{ version: string; update: UpdateStatus }>('app.updateStatus')
    printResult(result, json, formatUpdate)
  },
  'backup status': async ({ client, json }) => {
    const result = await client.call<CloudBackupStatus>('backup.status')
    printResult(result, json, formatBackup)
  },
  'backup run': async ({ client, json }) => {
    noteWaitingForConfirmation(json)
    const result = await client.call<CloudBackupStatus>('backup.run')
    printResult(result, json, (status) => `Backup started.\n${formatBackup(status)}`)
  },
  feedback: async ({ flags, client, json }) => {
    const text = getRequiredStringFlag(flags, 'text')
    noteWaitingForConfirmation(json)
    const result = await client.call<{ sent: true }>('feedback.submit', { text })
    printResult(result, json, () => 'Feedback sent. Thank you.')
  }
}
