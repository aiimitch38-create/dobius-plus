import type {
  CreateWorktreeResult,
  TuiAgent,
  WorktreeDefaultTabsLaunch,
  WorktreeSetupLaunch,
  WorktreeStartupLaunch
} from './types'
import type { AgentCursorEvent } from './agent-cursor'

/**
 * Main asks the renderer to launch an agent console card on a worktree's Board
 * (lead loop: `dobius board spawn-console`). Caps were already checked in main;
 * the renderer re-checks and handles each requestId once.
 */
export type RuntimeBoardSpawnConsoleEvent = {
  type: 'boardSpawnConsole'
  requestId: string
  worktreeId: string
  agent: TuiAgent
  title: string
  /** Delivered through the agent prompt path, never the launch command line. */
  prompt?: string
  /** `worker:<lead>` or `lead:<lead>` (see shared/lead-caps). */
  role: string
  leadId: string
  taskId?: string
  commandOverride?: string
  /**
   * Console cards for this role whose terminal is gone; the renderer removes
   * them before adding the new card so a relaunch never stacks duplicates.
   */
  replaceStaleCardIds?: string[]
}

/** Main asks the renderer to open a web tile card on a worktree's Board (`dobius board open-tile`). */
export type RuntimeBoardOpenWebTileEvent = {
  type: 'boardOpenWebTile'
  requestId: string
  worktreeId: string
  /** http(s) only; validated in main. */
  url: string
  title?: string
  /** Agent that asked for the tile; the card is created in the private session. */
  agentId?: string
}

/** Client-event copy of an agent cursor event: the gate requestId is never relayed (approval is window-only). */
export type RuntimeAgentCursorClientEventPayload = AgentCursorEvent

/** An agent cursor event relayed to paired web/remote clients (window IPC `ui:agentCursor` carries the full event). */
export type RuntimeAgentCursorClientEvent = {
  type: 'agentCursor'
  event: RuntimeAgentCursorClientEventPayload
}

export type RuntimeClientEvent =
  | RuntimeBoardSpawnConsoleEvent
  | RuntimeBoardOpenWebTileEvent
  | RuntimeAgentCursorClientEvent
  | { type: 'reposChanged' }
  | { type: 'worktreesChanged'; repoId: string }
  | {
      type: 'linearLinkedIssueUpdated'
      worktreeId: string
      identifier: string
      workspaceId: string
    }
  | {
      type: 'activateWorktree'
      repoId: string
      worktreeId: string
      setup?: WorktreeSetupLaunch
      startup?: WorktreeStartupLaunch
      defaultTabs?: WorktreeDefaultTabsLaunch
    }

export type RuntimeClientEventStreamMessage =
  | ({ type: 'ready'; subscriptionId: string } & {
      snapshot?: {
        // Reserved for future hydration. Current clients refresh through the
        // existing repo/worktree RPCs after receiving server events.
        repos?: unknown[]
      }
    })
  | RuntimeClientEvent
  | { type: 'end' }

export type RuntimeActivateWorktreeEvent = Extract<RuntimeClientEvent, { type: 'activateWorktree' }>

export function toRuntimeActivateWorktreeEvent(
  repoId: string,
  worktreeId: string,
  setup?: CreateWorktreeResult['setup'],
  startup?: WorktreeStartupLaunch,
  defaultTabs?: CreateWorktreeResult['defaultTabs']
): RuntimeActivateWorktreeEvent {
  return {
    type: 'activateWorktree',
    repoId,
    worktreeId,
    ...(setup ? { setup } : {}),
    ...(startup ? { startup } : {}),
    ...(defaultTabs ? { defaultTabs } : {})
  }
}
