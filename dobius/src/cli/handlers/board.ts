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
  }
}
