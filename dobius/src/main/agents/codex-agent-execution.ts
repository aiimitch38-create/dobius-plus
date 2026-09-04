import { spawn, type ChildProcess } from 'node:child_process'
import type { CustomAgent } from '../../shared/agents'
import { getSpawnArgsForWindows } from '../win32-utils'
import { buildSystemPrompt } from './agent-run-prompt'

function codexPrompt(agent: CustomAgent, prompt: string): string {
  const systemPrompt = buildSystemPrompt(agent).trim()
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
  onAssistantText: (text: string) => void
  onFinish: (status: 'success' | 'error' | 'cancelled', summary: string) => void
  isCancelled: () => boolean
}): ChildProcess {
  const commandArgs = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    args.agent.bypassPermissions ? 'danger-full-access' : 'workspace-write'
  ]
  if (args.agent.model.trim()) {
    commandArgs.push('--model', args.agent.model.trim())
  }
  commandArgs.push('-')
  const environment = {
    ...process.env,
    ...(args.codexHome ? { CODEX_HOME: args.codexHome } : {})
  }
  const spawnConfig = getSpawnArgsForWindows('codex', commandArgs)
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
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const error = codexErrorFromLine(line)
      if (error) {
        lastError = error
      }
      const message = codexMessageFromLine(line)
      if (!message) {
        continue
      }
      lastMessage = message
      args.onAssistantText(message)
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_000)
  })
  child.once('error', (error) => {
    args.onFinish('error', error.message)
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
      args.onFinish('cancelled', 'stopped by user')
      return
    }
    args.onFinish(
      code === 0 ? 'success' : 'error',
      code === 0
        ? lastMessage || 'Codex completed the task.'
        : stderr.trim() || lastError || `Codex exited with code ${code}`
    )
  })
  child.stdin?.end(codexPrompt(args.agent, args.prompt))
  return child
}
