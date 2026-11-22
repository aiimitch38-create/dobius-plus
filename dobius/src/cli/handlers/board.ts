import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CommandHandler } from '../dispatch'
import type { RuntimeTerminalSend } from '../../shared/runtime-types'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  getOptionalWorktreeSelector,
  BOARD_CARD_ADDRESS_PREFIX,
  getRequiredWorktreeSelector,
  resolveCurrentWorktreeSelector
} from '../selectors'

type SpawnConsoleResult = { requestId: string; worktreeId: string; role: string }
type BoardConsole = {
  tabId: string
  title: string
  role: string | null
  // Why optional: an older paired runtime returns only tabId, title and role.
  agent?: string | null
  handle?: string | null
  running?: boolean
  paneUnclear?: boolean
  worktreePath?: string
}
type OpenTileResult = { requestId: string; worktreeId: string; cardId: string; browserPageId: string }
type AgentControlResult = {
  ok: boolean
  agentId: string
  action: string
  state: { paused: boolean; stopped: boolean; takenOverUntil: number }
  gateResolved?: boolean
}

export function formatConsoles(consoles: BoardConsole[]): string {
  if (consoles.length === 0) {
    return 'No console cards on this board.'
  }
  return consoles
    .map((c) => {
      const terminal =
        c.running === undefined
          ? 'unknown'
          : c.paneUnclear
            ? 'pane unclear'
            : c.running && c.handle
              ? c.handle
              : 'not running'
      return `${c.tabId}  ${terminal}  ${c.agent ?? '-'}  ${c.role ?? '-'}  ${c.title}`
    })
    .join('\n')
}

const PASTE_SETTLE_MS = 500

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
  'board send': async ({ client, flags, cwd, json }) => {
    const cardFlag = getRequiredStringFlag(flags, 'card')
    const card = cardFlag.startsWith(BOARD_CARD_ADDRESS_PREFIX)
      ? cardFlag.slice(BOARD_CARD_ADDRESS_PREFIX.length)
      : cardFlag
    const text = getRequiredStringFlag(flags, 'text')
    const worktree =
      (await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)) ??
      (await resolveCurrentWorktreeSelector(cwd, client))
    // Why: the card is looked up right before the write, and the runtime refuses
    // an unknown, ambiguous or not-running card. There is no other target.
    const resolved = await client.call<{ handle: string; title: string }>('board.resolveConsole', {
      worktree,
      card
    })
    const { handle, title } = resolved.result
    // Why guarded and in two steps: text for an agent must not land in a bare
    // shell or on a permission prompt. The runtime checks that an agent is
    // running and is not waiting on a permission before the text, and again
    // before Enter; it refuses a guarded call that carries both at once.
    const guardedSend = async (
      part: { text: string } | { enter: true },
      refused: (reason: string, bytesTyped: number) => string
    ): Promise<{ send: RuntimeTerminalSend }> => {
      const sent = await client.call<{ send: RuntimeTerminalSend }>('terminal.send', {
        terminal: handle,
        ...part,
        requireAgentStatus: 'sendable',
        client: { id: 'dobius-cli', type: 'desktop' }
      })
      if (!sent.result.send.accepted) {
        const reason =
          sent.result.send.refusedReason === 'no-agent'
            ? 'no agent is running in it'
            : sent.result.send.refusedReason === 'permission'
              ? 'its agent is waiting on a permission prompt'
              : 'it is not accepting input'
        throw new RuntimeClientError(
          'board_card_send_refused',
          refused(reason, sent.result.send.bytesWritten)
        )
      }
      return sent.result
    }
    const cardLabel = `Console card "${title}" (${handle})`
    const clearFirst = `Read it with \`dobius terminal read --terminal ${handle}\` and clear its input line before sending again.`
    const typed = await guardedSend({ text }, (reason, bytesTyped) =>
      bytesTyped > 0
        ? // A long text goes in chunks; the guard can flip between two of them.
          `${cardLabel} stopped part-way: ${reason}. The first ${bytesTyped} bytes of the text are typed in and were not submitted. ${clearFirst}`
        : `${cardLabel} did not accept the text: ${reason}. Nothing was sent.`
    )
    if (flags.get('enter') === true) {
      // Why: an agent's input box needs a moment to take in pasted text; an Enter
      // sent at once can be swallowed. Same pause the runtime uses for a combined send.
      await new Promise((resolve) => setTimeout(resolve, PASTE_SETTLE_MS))
      await guardedSend(
        { enter: true },
        (reason) =>
          `${cardLabel} has the text typed in, but Enter was not pressed: ${reason}. ${clearFirst}`
      )
    }
    const result = { ...resolved, result: typed }
    printResult(
      result,
      json,
      (value) => `Sent ${value.send.bytesWritten} bytes to card "${title}" (${value.send.handle}).`
    )
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
