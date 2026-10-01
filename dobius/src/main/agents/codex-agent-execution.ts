import { spawn, type ChildProcess } from 'node:child_process'
import type { CustomAgent } from '../../shared/agents'
import { resolveCodexCommand } from '../codex-cli/command'
import { getSpawnArgsForWindows } from '../win32-utils'
import { buildSystemPrompt } from './agent-run-prompt'
import { codexToolStepFromLine } from './codex-run-policy'

function codexPrompt(agent: CustomAgent, prompt: string, contextBanner?: string): string {
  // Codex has no system-prompt option: the agent's prompt and the context
  // banner (B5) share the one prefix ahead of the user request.
  const systemPrompt = [buildSystemPrompt(agent).trim(), contextBanner ?? '']
    .filter(Boolean)
    .join('\n\n')
  return systemPrompt ? `${systemPrompt}\n\nUser request:\n${prompt}` : prompt
}

export function codexMessageFromLine(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>
    if (event.type !== 'item.completed' || !event.item || typeof event.item !== 'object') {
      return null
    }
    const item = event.item as Record<string, unknown>
    return item.type === 'agent_message' && typeof item.text === 'string' ? item.text : null
  } catch {
    return null
  }
}

/**
 * codex's own `message` fields are sometimes a plain string and sometimes a
 * JSON-encoded error object one level down (observed:
 * `{"type":"error","message":"{\"type\":\"error\",...,\"error\":{\"message\":\"...\"}}"}`)
 * — unwrap one layer so the surfaced summary is the human sentence, not raw JSON.
 */
export function unwrapCodexErrorMessage(message: string): string {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>
    const nested = parsed.error as Record<string, unknown> | undefined
    const inner = nested?.message ?? parsed.message
    return typeof inner === 'string' && inner.trim() ? inner : message
  } catch {
    return message
  }
}

/**
 * codex only ever surfaces a real failure reason on `turn.failed` (most
 * specific) or a top-level `error` event — a non-zero exit with no stderr
 * used to fall back to the opaque "Codex exited with code N" because these
 * were never read (see LESSONS-LEARNED / Edith diagnosis, 2026-09-04).
 */
export function codexErrorFromLine(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>
    if (event.type === 'turn.failed') {
      const error = event.error as Record<string, unknown> | undefined
      return typeof error?.message === 'string' ? unwrapCodexErrorMessage(error.message) : null
    }
    if (event.type === 'error') {
      return typeof event.message === 'string' ? unwrapCodexErrorMessage(event.message) : null
    }
    return null
  } catch {
    return null
  }
}

export function startCodexAgentProcess(args: {
  agent: CustomAgent
  prompt: string
  cwd: string
  codexHome: string | null
  /** Extra env for the spawned process (ADAM's admitted context); merged over process.env. */
  env?: Record<string, string>
  /** One line of admitted-run context, placed with the agent's own prompt. */
  contextBanner?: string
  /** Per-run model override; absent = the agent's configured model. */
  model?: string
  /** Tool steps allowed before the run is stopped (Codex has no turn option of its own). */
  maxSteps: number
  onAssistantText: (text: string) => void
  onFinish: (status: 'success' | 'error' | 'cancelled', summary: string) => void
  isCancelled: () => boolean
}): ChildProcess {
  const commandArgs = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    // Why: spawned sub-agents would run outside the step cap this run enforces.
    '--disable',
    'multi_agent',
    '--sandbox',
    args.agent.bypassPermissions ? 'danger-full-access' : 'workspace-write'
  ]
  const model = (args.model ?? args.agent.model).trim()
  if (model) {
    commandArgs.push('--model', model)
  }
  commandArgs.push('-')
  const environment = {
    ...process.env,
    ...(args.codexHome ? { CODEX_HOME: args.codexHome } : {}),
    ...args.env
  }
  // Why: a GUI-launched app has a minimal PATH, so a bare `codex` spawn fails
  // with ENOENT even when Codex is installed under a version manager.
  const spawnConfig = getSpawnArgsForWindows(resolveCodexCommand(), commandArgs)
  const child = spawn(spawnConfig.spawnCmd, spawnConfig.spawnArgs, {
    cwd: args.cwd,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  let stdoutBuffer = ''
  let stderr = ''
  let lastMessage = ''
  let lastError = ''
  let stdinError = ''
  let stopReason = ''
  const toolSteps = new Set<string>()
  // Why: a failed spawn emits 'error' and then 'close'; the run must settle once.
  let settled = false
  const finish = (status: 'success' | 'error' | 'cancelled', summary: string): void => {
    if (settled) {
      return
    }
    settled = true
    args.onFinish(status, summary)
  }
  const readLine = (line: string): void => {
    const error = codexErrorFromLine(line)
    if (error) {
      lastError = error
    }
    const step = codexToolStepFromLine(line)
    if (step) {
      toolSteps.add(step)
      if (toolSteps.size > args.maxSteps) {
        stopReason = `Codex run stopped: it exceeded its limit of ${args.maxSteps} tool steps.`
        child.kill('SIGTERM')
        return
      }
    }
    const message = codexMessageFromLine(line)
    if (message) {
      lastMessage = message
      args.onAssistantText(message)
    }
  }
  child.stdout?.on('data', (chunk: Buffer) => {
    if (stopReason) {
      return
    }
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      readLine(line)
      if (stopReason) {
        return
      }
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_000)
  })
  child.on('error', (error) => {
    finish('error', error.message)
  })
  // Why: without a listener, EPIPE (Codex exited before reading the prompt) or a
  // write to a never-spawned child is an uncaught exception in the main process.
  child.stdin?.on('error', (error) => {
    stdinError = error.message
  })
  child.once('close', (code) => {
    const trailingMessage = codexMessageFromLine(stdoutBuffer)
    if (trailingMessage) {
      lastMessage = trailingMessage
    }
    const trailingError = codexErrorFromLine(stdoutBuffer)
    if (trailingError) {
      lastError = trailingError
    }
    if (args.isCancelled()) {
      finish('cancelled', 'stopped by user')
      return
    }
    if (stopReason) {
      finish('error', stopReason)
      return
    }
    if (code === 0 && stdinError) {
      finish('error', `Codex did not receive the prompt: ${stdinError}`)
      return
    }
    finish(
      code === 0 ? 'success' : 'error',
      code === 0
        ? lastMessage || 'Codex completed the task.'
        : stderr.trim() || lastError || stdinError || `Codex exited with code ${code}`
    )
  })
  child.stdin?.end(codexPrompt(args.agent, args.prompt, args.contextBanner))
  return child
}
