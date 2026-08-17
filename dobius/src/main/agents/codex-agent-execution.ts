import { spawn, type ChildProcess } from 'node:child_process'
import type { CustomAgent } from '../../shared/agents'
import { getSpawnArgsForWindows } from '../win32-utils'
import { buildSystemPrompt } from './agent-run-prompt'

function codexPrompt(agent: CustomAgent, prompt: string): string {
  const systemPrompt = buildSystemPrompt(agent).trim()
  return systemPrompt ? `${systemPrompt}\n\nUser request:\n${prompt}` : prompt
}

function codexMessageFromLine(line: string): string | null {
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
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
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
    if (args.isCancelled()) {
      args.onFinish('cancelled', 'stopped by user')
      return
    }
    args.onFinish(
      code === 0 ? 'success' : 'error',
      code === 0
        ? lastMessage || 'Codex completed the task.'
        : stderr.trim() || `Codex exited with code ${code}`
    )
  })
  child.stdin?.end(codexPrompt(args.agent, args.prompt))
  return child
}
