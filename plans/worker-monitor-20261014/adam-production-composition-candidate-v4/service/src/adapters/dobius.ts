import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type DobiusAgentStatus = {
  paneKey: string
  state: 'working' | 'blocked' | 'waiting' | 'done'
  agentType?: string
  prompt?: string
  lastAssistantMessage?: string | null
  toolName?: string | null
  toolInput?: string | null
  interrupted?: boolean
  stateStartedAt?: number
  updatedAt?: number
}

export type DobiusWorktreeStatus = {
  worktreeId: string
  repoId?: string
  repo?: string
  path: string
  branch?: string
  displayName?: string
  status?: string
  lastOutputAt?: number | null
  agents: DobiusAgentStatus[]
}

type DobiusEnvelope<T> = {
  ok: boolean
  result?: T
  error?: string | { code?: string; message?: string }
  _meta?: { runtimeId?: string }
}

export interface DobiusAwarenessClient {
  worktreePs(limit?: number): Promise<{ worktrees: DobiusWorktreeStatus[]; runtimeId?: string }>
}

export type DobiusTerminal = {
  handle: string
  paneKey?: string
  worktreeId?: string
  state?: string
  agentType?: string
  tail?: string[]
  [key: string]: unknown
}

export type DobiusTerminalResult = { terminal: DobiusTerminal; [key: string]: unknown }

export type DobiusRepo = {
  id: string
  path: string
  displayName: string
  upstream?: string | null
  [key: string]: unknown
}

export type DobiusWorktree = {
  id: string
  repoId: string
  path: string
  branch?: string
  displayName?: string
  isMainWorktree?: boolean
  [key: string]: unknown
}

export interface DobiusTerminalClient {
  terminalShow(handle: string): Promise<DobiusTerminalResult>
  terminalRead(handle: string, limit?: number): Promise<DobiusTerminalResult>
  terminalSend(handle: string, prompt: string): Promise<DobiusTerminalResult>
  terminalClose?(handle: string): Promise<DobiusTerminalResult>
}

export class DobiusBundleUnavailableError extends Error {
  readonly code = 'DOBIUS_BUNDLE_UNAVAILABLE'
  readonly transient = true

  constructor(message: string, readonly retryAfterMs = 2_000) {
    super(message)
    this.name = 'DobiusBundleUnavailableError'
  }
}

export type DobiusBundleGuardOptions = {
  bundlePath?: string
  stabilityWindowMs?: number
  minimumFrameworkBytes?: number
}

type BundleSnapshot = { launcherSize: number; frameworkSize: number; frameworkMtimeMs: number; cliSize: number }

export class DobiusClient implements DobiusAwarenessClient {
  private readonly bundlePath: string
  private readonly stabilityWindowMs: number
  private readonly minimumFrameworkBytes: number
  private lastBundleSnapshot: BundleSnapshot | undefined
  private callTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly binary = 'dobius',
    private readonly timeoutMs = 20_000,
    guard: DobiusBundleGuardOptions = {}
  ) {
    this.bundlePath = guard.bundlePath ?? '/Applications/Dobius+.app'
    this.stabilityWindowMs = guard.stabilityWindowMs ?? 500
    this.minimumFrameworkBytes = guard.minimumFrameworkBytes ?? 50 * 1024 * 1024
  }

  private snapshotBundle(): BundleSnapshot {
    const launcher = join(this.bundlePath, 'Contents', 'MacOS', 'Dobius+')
    const frameworkLink = join(this.bundlePath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')
    const frameworkSignature = join(this.bundlePath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'Current', '_CodeSignature', 'CodeResources')
    const cli = join(this.bundlePath, 'Contents', 'Resources', 'app.asar.unpacked', 'out', 'cli', 'index.js')
    try {
      const launcherStat = statSync(launcher)
      const framework = realpathSync(frameworkLink)
      const frameworkStat = statSync(framework)
      const cliStat = statSync(cli)
      const signatureStat = statSync(frameworkSignature)
      if (!launcherStat.isFile() || !frameworkStat.isFile() || !cliStat.isFile() || !signatureStat.isFile()) {
        throw new Error('required Dobius bundle component is not a regular file')
      }
      if (frameworkStat.size < this.minimumFrameworkBytes) {
        throw new Error(`Electron Framework is incomplete (${frameworkStat.size} bytes)`)
      }
      return {
        launcherSize: launcherStat.size,
        frameworkSize: frameworkStat.size,
        frameworkMtimeMs: frameworkStat.mtimeMs,
        cliSize: cliStat.size
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new DobiusBundleUnavailableError(`Dobius+ bundle is incomplete or being updated; launch suppressed. ${detail}`)
    }
  }

  async assertBundleReady(): Promise<void> {
    const before = this.snapshotBundle()
    if (this.lastBundleSnapshot && JSON.stringify(before) === JSON.stringify(this.lastBundleSnapshot)) return
    await new Promise((resolve) => setTimeout(resolve, this.stabilityWindowMs))
    const after = this.snapshotBundle()
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new DobiusBundleUnavailableError('Dobius+ bundle changed during the stability window; launch suppressed until installation completes')
    }
    this.lastBundleSnapshot = after
  }

  async call<T>(args: string[]): Promise<T> {
    const task = this.callTail.then(() => this.executeCall<T>(args))
    this.callTail = task.then(() => undefined, () => undefined)
    return task
  }

  private async executeCall<T>(args: string[]): Promise<T> {
    await this.assertBundleReady()
    const { stdout } = await execFileAsync(this.binary, [...args, '--json'], {
      timeout: this.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8'
    })
    let envelope: DobiusEnvelope<T>
    try {
      envelope = JSON.parse(stdout) as DobiusEnvelope<T>
    } catch {
      throw new Error(`Dobius returned invalid JSON for ${args.join(' ')}`)
    }
    if (!envelope.ok || envelope.result === undefined) {
      const detail = typeof envelope.error === 'string'
        ? envelope.error
        : envelope.error?.message
      throw new Error(detail || `Dobius command failed: ${args.join(' ')}`)
    }
    return envelope.result
  }

  async status(): Promise<unknown> {
    return this.call(['status'])
  }

  async worktreePs(limit = 100): Promise<{ worktrees: DobiusWorktreeStatus[]; runtimeId?: string }> {
    const result = await this.call<{ worktrees: DobiusWorktreeStatus[] }>([
      'worktree',
      'ps',
      '--limit',
      String(limit)
    ])
    return result
  }

  async terminalList(limit = 100, worktree?: string): Promise<{ terminals: DobiusTerminal[] }> {
    return this.call(['terminal', 'list', ...(worktree ? ['--worktree', worktree] : []), '--limit', String(limit)])
  }

  async terminalShow(handle: string): Promise<DobiusTerminalResult> {
    return this.call(['terminal', 'show', '--terminal', handle])
  }

  async terminalRead(handle: string, limit = 200): Promise<DobiusTerminalResult> {
    return this.call(['terminal', 'read', '--terminal', handle, '--limit', String(limit)])
  }

  async terminalSend(handle: string, prompt: string): Promise<DobiusTerminalResult> {
    return this.call(['terminal', 'send', '--terminal', handle, '--text', prompt, '--enter'])
  }

  async terminalClose(handle: string): Promise<DobiusTerminalResult> {
    return this.call(['terminal', 'close', '--terminal', handle])
  }

  async terminalWait(handle: string, condition: 'exit' | 'tui-idle', timeoutMs: number): Promise<DobiusTerminalResult> {
    return this.call(['terminal', 'wait', '--terminal', handle, '--for', condition, '--timeout-ms', String(timeoutMs)])
  }

  async repoShow(selector: string): Promise<{ repo: DobiusRepo }> {
    return this.call(['repo', 'show', '--repo', selector])
  }

  async repoSearchRefs(selector: string, query: string, limit = 20): Promise<Record<string, unknown>> {
    return this.call(['repo', 'search-refs', '--repo', selector, '--query', query, '--limit', String(limit)])
  }

  async worktreeList(repoSelector: string, limit = 100): Promise<{ worktrees: DobiusWorktree[] }> {
    return this.call(['worktree', 'list', '--repo', repoSelector, '--limit', String(limit)])
  }

  async worktreeCreate(input: {
    repoSelector: string
    name: string
    baseRef?: string
    noParent?: boolean
    setup?: 'run' | 'skip' | 'inherit'
  }): Promise<{ worktree: DobiusWorktree }> {
    return this.call([
      'worktree', 'create', '--repo', input.repoSelector, '--name', input.name,
      ...(input.baseRef ? ['--base-branch', input.baseRef] : []),
      ...(input.noParent ? ['--no-parent'] : []),
      '--setup', input.setup ?? 'inherit'
    ])
  }

  async terminalCreate(input: { worktreeSelector: string; title: string; command: string }): Promise<DobiusTerminalResult> {
    return this.call(['terminal', 'create', '--worktree', input.worktreeSelector, '--title', input.title, '--command', input.command])
  }
}
