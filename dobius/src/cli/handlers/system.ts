import type { RuntimeWorktreeRecord } from '../../shared/runtime-types'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../shared/skills'
import type { SystemMonitorView } from '../../shared/system-monitor-view'
import type {
  WorkspacePort,
  WorkspacePortKillResult,
  WorkspacePortScanResult
} from '../../shared/workspace-ports'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalWorktreeSelector, getRequiredWorktreeSelector } from '../selectors'

/** Exit code when the runtime refused to stop the process. */
export const PORT_KILL_REFUSED_EXIT_CODE = 3

function getPortNumberFlag(flags: Map<string, string | boolean>, name: string): number | undefined {
  const value = getOptionalStringFlag(flags, name)
  if (value === undefined) {
    if (flags.has(name)) {
      throw new RuntimeClientError('invalid_argument', `Missing value for --${name}`)
    }
    return undefined
  }
  const parsed = /^\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RuntimeClientError('invalid_argument', `--${name} must be a positive whole number`)
  }
  return parsed
}

async function showWorktree(ctx: HandlerContext, selector: string): Promise<RuntimeWorktreeRecord> {
  const shown = await ctx.client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
    worktree: selector
  })
  return shown.result.worktree
}

function ownedBy(worktreeId: string): (port: WorkspacePort) => boolean {
  return (port) => port.kind === 'workspace' && port.owner.worktreeId === worktreeId
}

function formatPort(port: WorkspacePort): string {
  const owner = port.kind === 'workspace' ? port.owner.displayName : port.kind
  const url = port.kind === 'workspace' && port.advertisedUrl
    ? port.advertisedUrl
    : `${port.protocol === 'https' ? 'https' : 'http'}://${port.connectHost}:${port.port}`
  return `${String(port.port).padEnd(6)} pid ${String(port.pid ?? '?').padEnd(7)} ${(port.processName ?? '?').padEnd(16)} ${owner.padEnd(20)} ${url}`
}

function formatPorts(result: WorkspacePortScanResult): string {
  if (result.unavailableReason) {
    return `Port scan unavailable: ${result.unavailableReason}`
  }
  return result.ports.length === 0 ? 'No listening ports.' : result.ports.map(formatPort).join('\n')
}

function formatSkill(skill: DiscoveredSkill): string {
  const description = skill.description ? `  ${skill.description}` : ''
  return `${skill.name}  [${skill.sourceLabel}]${description}`
}

function formatSystem(result: { configured: boolean; status: SystemMonitorView | null }): string {
  if (!result.configured || !result.status) {
    return 'System monitor is not running.'
  }
  const { status } = result
  const lines = [`Health: ${status.health} (${status.freshness})`]
  for (const volume of status.volumes) {
    const freeGb = (volume.freeBytes / 1024 ** 3).toFixed(1)
    const totalGb = (volume.totalBytes / 1024 ** 3).toFixed(1)
    lines.push(`${volume.id}: ${freeGb} GB free of ${totalGb} GB (${volume.state})`)
  }
  return lines.join('\n')
}

function formatPreflight(result: Record<string, unknown>): string {
  return Object.entries(result)
    .map(([tool, value]) => {
      const record = (value ?? {}) as Record<string, unknown>
      const parts = Object.entries(record)
        .filter(([, v]) => typeof v === 'boolean')
        .map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`)
      return `${tool}: ${parts.join(' ') || JSON.stringify(value)}`
    })
    .join('\n')
}

function refusePortKill(reason: string): never {
  throw new RuntimeClientError('invalid_argument', `Refused: ${reason} Nothing was stopped.`)
}

function describeOwner(port: WorkspacePort): string {
  if (port.kind === 'workspace') {
    return 'another worktree'
  }
  return port.kind === 'container' ? 'a container' : 'another app or the system'
}

export const SYSTEM_HANDLERS: Record<string, CommandHandler> = {
  ports: async (ctx) => {
    const selector = await getOptionalWorktreeSelector(ctx.flags, 'worktree', ctx.cwd, ctx.client)
    if (!selector) {
      if (ctx.flags.has('worktree')) {
        throw new RuntimeClientError('invalid_argument', 'Missing value for --worktree.')
      }
      const result = await ctx.client.call<WorkspacePortScanResult>('workspacePorts.scan', {})
      printResult(result, ctx.json, formatPorts)
      return
    }
    const worktree = await showWorktree(ctx, selector)
    // Why: scan against every worktree; a repo filter hides nested worktrees
    // of other repos and their ports would be credited to the parent.
    const result = await ctx.client.call<WorkspacePortScanResult>('workspacePorts.scan', {})
    printResult(
      { ...result, result: { ...result.result, ports: result.result.ports.filter(ownedBy(worktree.id)) } },
      ctx.json,
      formatPorts
    )
  },
  'ports kill': async (ctx) => {
    const port = getPortNumberFlag(ctx.flags, 'port')
    if (port === undefined) {
      throw new RuntimeClientError('invalid_argument', 'Missing required --port')
    }
    const requestedPid = getPortNumberFlag(ctx.flags, 'pid')
    const worktree = await showWorktree(
      ctx,
      await getRequiredWorktreeSelector(ctx.flags, 'worktree', ctx.cwd, ctx.client)
    )
    const scan = await ctx.client.call<WorkspacePortScanResult>('workspacePorts.scan', {})
    const listening = scan.result.ports.filter((candidate) => candidate.port === port)
    const owned = listening.filter(
      (candidate) => ownedBy(worktree.id)(candidate) && candidate.kind === 'workspace' && candidate.owner.confidence === 'cwd'
    )
    if (owned.length === 0 && listening.some(ownedBy(worktree.id))) {
      refusePortKill(
        `Dobius cannot prove the process on port ${port} was started from ${worktree.displayName || worktree.id} (only its command line mentions it).`
      )
    }
    const pids = [...new Set(owned.map((candidate) => candidate.pid).filter((pid) => pid !== undefined))]
    if (owned.length === 0) {
      refusePortKill(
        listening.length === 0
          ? `nothing is listening on port ${port}.`
          : `port ${port} is not owned by a process of ${worktree.displayName || worktree.id} (it belongs to ${describeOwner(listening[0]!)}).`
      )
    }
    const pid = requestedPid ?? (pids.length === 1 ? pids[0] : undefined)
    if (pid === undefined) {
      refusePortKill(
        pids.length === 0
          ? `the process on port ${port} is unknown.`
          : `more than one process listens on port ${port} (${pids.join(', ')}); pass --pid.`
      )
    }
    if (!pids.includes(pid)) {
      refusePortKill(`pid ${pid} does not own port ${port} in ${worktree.displayName || worktree.id}.`)
    }
    // Why: the runtime re-scans and re-checks the owner (worktreeId) before
    // SIGTERM, so a port that changed hands since our scan is still refused.
    const result = await ctx.client.call<WorkspacePortKillResult>('workspacePorts.kill', {
      worktreeId: worktree.id,
      pid,
      port
    })
    printResult(result, ctx.json, (value) =>
      value.ok ? `Stopped pid ${pid} on port ${port}.` : `Refused: ${value.reason}`
    )
    if (!result.result.ok) {
      process.exitCode = PORT_KILL_REFUSED_EXIT_CODE
    }
  },
  'skills list': async (ctx) => {
    const result = await ctx.client.call<SkillDiscoveryResult>('skills.discover', {})
    printResult(result, ctx.json, ({ skills }) =>
      skills.length === 0 ? 'No skills found.' : skills.map(formatSkill).join('\n')
    )
  },
  system: async (ctx) => {
    const result = await ctx.client.call<{ configured: boolean; status: SystemMonitorView | null }>(
      'system.monitor.status'
    )
    printResult(result, ctx.json, formatSystem)
  },
  preflight: async (ctx) => {
    const result = await ctx.client.call<Record<string, unknown>>('preflight.check', {
      force: ctx.flags.get('force') === true
    })
    printResult(result, ctx.json, formatPreflight)
  }
}
