import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import {
  getOptionalWorktreeSelector,
  getRequiredWorktreeSelector,
  resolveCurrentWorktreeSelector
} from '../selectors'

type SpawnConsoleResult = { requestId: string; worktreeId: string; role: string }
type BoardConsole = { tabId: string; title: string; role: string | null }
type OpenTileResult = { requestId: string; worktreeId: string; cardId: string; browserPageId: string }
type AgentControlResult = {
  ok: boolean
  agentId: string
  action: string
  state: { paused: boolean; stopped: boolean; takenOverUntil: number }
  gateResolved?: boolean
}

function formatConsoles(consoles: BoardConsole[]): string {
  if (consoles.length === 0) {
    return 'No console cards on this board.'
  }
  return consoles
    .map((c) => `${c.tabId}  ${c.role ?? '-'}  ${c.title}`)
    .join('\n')
}

export const BOARD_HANDLERS: Record<string, CommandHandler> = {
  'board spawn-console': async ({ client, flags, cwd, json }) => {
    const promptFileFlag = getOptionalStringFlag(flags, 'prompt-file')
    const promptFile = promptFileFlag ? resolve(cwd, promptFileFlag) : undefined
    // Why: a paired remote runtime cannot see this machine's files, so the
    // prompt is read here and sent as text; locally main reads the file itself.
    const prompt =
      promptFile && client.isRemote
        ? readFileSync(promptFile, 'utf8')
        : getOptionalStringFlag(flags, 'prompt')
    const result = await client.call<SpawnConsoleResult>('board.spawnConsole', {
      worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client),
      agent: getRequiredStringFlag(flags, 'agent'),
      title: getRequiredStringFlag(flags, 'title'),
      prompt,
      promptFile: client.isRemote ? undefined : promptFile,
      role: getOptionalStringFlag(flags, 'role') ?? 'worker',
      leadId: getRequiredStringFlag(flags, 'lead'),
      taskId: getOptionalStringFlag(flags, 'task'),
      commandOverride: getOptionalStringFlag(flags, 'command-override')
    })
    printResult(
      result,
      json,
      (value) =>
        `Spawn requested: ${value.role} console on worktree ${value.worktreeId} (request ${value.requestId}).`
    )
  },
  'board consoles': async ({ client, flags, cwd, json }) => {
    const worktree =
      (await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)) ??
      (await resolveCurrentWorktreeSelector(cwd, client))
    const result = await client.call<BoardConsole[]>('board.listConsoles', { worktree })
    printResult(result, json, formatConsoles)
  },
  'board open-tile': async ({ client, flags, cwd, json }) => {
    const worktree =
      (await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)) ??
      (await resolveCurrentWorktreeSelector(cwd, client))
    const agentId = getOptionalStringFlag(flags, 'as') ?? process.env.DOBIUS_AGENT_ID
    const result = await client.call<OpenTileResult>('board.openWebTile', {
      worktree,
      url: getRequiredStringFlag(flags, 'url'),
      title: getOptionalStringFlag(flags, 'title'),
      ...(agentId ? { agentId } : {})
    })
    printResult(
      result,
      json,
      (value) => `Web tile ${value.cardId} is open on worktree ${value.worktreeId}; drive it with --page ${value.browserPageId}.`
    )
  },
  'board agent-control': async ({ client, flags, json }) => {
    const result = await client.call<AgentControlResult>('board.agentControl', {
      agentId: getRequiredStringFlag(flags, 'agent'),
      action: getRequiredStringFlag(flags, 'action')
    })
    printResult(result, json, (value) => {
      const flagsText = [
        value.state.paused ? 'paused' : null,
        value.state.stopped ? 'stopped' : null,
        value.state.takenOverUntil > Date.now() ? 'taken over' : null
      ]
        .filter((v): v is string => v !== null)
        .join(', ')
      const status = value.ok ? 'applied' : 'not applied'
      return `${value.action} for ${value.agentId}: ${status}. State: ${flagsText || 'running'}.`
    })
  }
}
