import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  AgentProviderLaunchResult,
  AgentProviderStatusSnapshot,
  AgentRunEvent,
  CustomHarnessDefinition
} from '../../../shared/agents'
import type { AgentProvider, AgentProviderLaunch, AgentProviderStreamEvent } from './agent-provider'
import { bindProviderIdentity } from './agent-provider-identity'

// Why: Node's execFile/spawn throw ERR_INVALID_ARG_VALUE on null bytes — the
// repo hard rule is to reject them at the seam instead of letting a saved
// harness crash the main process mid-spawn.
export function validateCustomHarnessDefinition(definition: CustomHarnessDefinition): void {
  const command = definition.command.trim()
  if (!command) {
    throw new Error('A custom harness needs a command')
  }
  if (command.includes('\x00')) {
    throw new Error('Harness command must not contain null bytes')
  }
  // A bare name (goose) resolves via PATH; an absolute path spawns directly.
  // Anything in between (./bin/acp, tools/acp) depends on the main process's
  // cwd and is ambiguous — reject rather than guess.
  if (!path.isAbsolute(command) && (command.includes('/') || command.includes('\\'))) {
    throw new Error(
      'Harness command must be an absolute path or a command resolvable on PATH'
    )
  }
  for (const arg of definition.args) {
    if (arg.includes('\x00')) {
      throw new Error('Harness args must not contain null bytes')
    }
  }
  for (const [key, value] of Object.entries(definition.env)) {
    if (key.includes('\x00') || value.includes('\x00')) {
      throw new Error('Harness env must not contain null bytes')
    }
  }
}

type HarnessDeps = {
  spawn?: typeof spawn
}

/**
 * Makes a saved Harness Catalog record executable: launch spawns the stored
 * command/args with the stored env merged over the app environment. Env values
 * are write-only — they flow into the child process environment and are never
 * returned by status(), events, or launch results, and never logged.
 */
export class CustomHarnessProvider implements AgentProvider {
  readonly providerId = 'custom-harness' as const
  readonly agentId: string

  private child: ChildProcess | null = null
  private state: AgentProviderStatusSnapshot['state'] = 'idle'
  private lastRunId: string | undefined
  private detail: string | undefined
  private listeners = new Set<(event: AgentProviderStreamEvent) => void>()

  constructor(
    private readonly definition: CustomHarnessDefinition,
    private readonly deps: HarnessDeps = {}
  ) {
    this.agentId = `custom-harness-${definition.id}`
  }

  async launch(launch: AgentProviderLaunch): Promise<AgentProviderLaunchResult> {
    validateCustomHarnessDefinition(this.definition)
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      throw new Error(`Harness ${this.definition.label} is already running`)
    }
    // Why: binding happens at launch so the harness exists as a Communications
    // participant even before its first reply — same pattern as huddle agents.
    const identity = bindProviderIdentity(this.agentId)

    const runId = randomUUID()
    this.lastRunId = runId
    this.detail = undefined
    // Env is write-only by construction: spread into the child env here and
    // never assigned to any field that status()/events read back.
    const spawnEnv = { ...process.env, ...this.definition.env }
    const spawnFn = this.deps.spawn ?? spawn
    const child = spawnFn(this.definition.command.trim(), [...this.definition.args], {
      cwd: launch.cwd,
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    this.state = 'running'
    this.emit({ kind: 'status', state: this.status() })

    // Why buffered: a chunk boundary can fall mid-line, so splitting each chunk
    // on its own emits one logical line as several run events. Hold the trailing
    // partial until the newline arrives, and flush whatever is left on close.
    let stdoutTail = ''
    let stderrTail = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = (stdoutTail + chunk.toString('utf8')).split('\n')
      stdoutTail = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) {
          this.emitRunEvent({ kind: 'system', detail: line })
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const lines = (stderrTail + chunk.toString('utf8')).split('\n')
      stderrTail = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) {
          this.emitRunEvent({ kind: 'error', text: line })
        }
      }
    })
    child.on('error', (error) => {
      this.state = 'failed'
      this.detail = error.message
      this.emitRunEvent({ kind: 'error', text: error.message })
      this.emit({ kind: 'status', state: this.status() })
    })
    child.once('close', (code) => {
      if (this.child !== child) {
        return
      }
      if (stdoutTail.trim()) {
        this.emitRunEvent({ kind: 'system', detail: stdoutTail })
      }
      if (stderrTail.trim()) {
        this.emitRunEvent({ kind: 'error', text: stderrTail })
      }
      stdoutTail = ''
      stderrTail = ''
      if (child.killed || code === null) {
        this.state = 'finished'
        this.detail = 'stopped by user'
        this.emitRunEvent({ kind: 'system', detail: 'stopped by user' })
      } else if (code === 0) {
        this.state = 'finished'
        this.detail = `${this.definition.label} exited cleanly`
        this.emitRunEvent({ kind: 'result', text: this.detail })
      } else {
        this.state = 'failed'
        this.detail = `${this.definition.label} exited with code ${code}`
        this.emitRunEvent({ kind: 'error', text: this.detail })
      }
      this.emit({ kind: 'status', state: this.status() })
    })

    await this.send(launch.prompt)
    return { runId, identityPubkey: identity.pubkey }
  }

  async send(text: string): Promise<void> {
    const child = this.child
    if (!child || !child.stdin || child.exitCode !== null || this.state !== 'running') {
      throw new Error(`Harness ${this.definition.label} is not running`)
    }
    const prompt = text.trim()
    if (!prompt) {
      throw new Error('Prompt is required')
    }
    await new Promise<void>((resolve, reject) => {
      child.stdin!.write(`${prompt}\n`, (error) => (error ? reject(error) : resolve()))
    })
  }

  subscribe(listener: (event: AgentProviderStreamEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async cancel(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      return
    }
    this.state = 'finished'
    child.kill('SIGTERM')
  }

  status(): AgentProviderStatusSnapshot {
    return {
      providerId: this.providerId,
      agentId: this.agentId,
      label: this.definition.label,
      state: this.state,
      lastRunId: this.lastRunId,
      detail: this.detail
    }
  }

  private emit(event: AgentProviderStreamEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private emitRunEvent(event: Omit<AgentRunEvent, 'runId' | 'agentId' | 'ts'>): void {
    if (!this.lastRunId) {
      return
    }
    this.emit({
      kind: 'run-event',
      event: {
        runId: this.lastRunId,
        agentId: this.agentId,
        ts: Date.now(),
        ...event
      }
    })
  }
}
