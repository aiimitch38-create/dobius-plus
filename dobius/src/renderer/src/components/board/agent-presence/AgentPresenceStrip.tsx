// Compact "who is here" strip in the Board chrome: one row per agent with
// Pause/Resume, Stop, Take over and Follow, plus an approval card when an
// agent waits on a gated action. Follow mode flies the camera to the agent's
// tile and draws a viewport border in its color; a manual pan ends it.
import React, { useEffect } from 'react'
import type { AgentGateKind } from '../../../../../shared/agent-cursor'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { focusBoardCard } from '../board-canvas/board-camera-focus'
import { BOARD_USER_PAN_EVENT } from '../board-canvas/board-pan-event'
import { BOARD_FLOATING_PANEL_CLASS } from '../board-chrome/board-surface-classes'
import { agentControl } from './agent-control-api'
import {
  noteUserCameraInteraction,
  removeAgent,
  setAutoFollowEnabled,
  setFollowedAgent,
  stopFollowingByUser,
  useAgentPresence,
  type AgentPresence
} from './agent-presence-state'

const ROW_BUTTON =
  'h-6 rounded-full px-2 text-[12px] font-semibold text-[var(--board-text)] hover:bg-[var(--board-panel-2)] disabled:opacity-40'

function gateLabel(kind: AgentGateKind): string {
  switch (kind) {
    case 'login':
      return translate('board.agents.gate.login', 'sign in')
    case 'purchase':
      return translate('board.agents.gate.purchase', 'make a purchase')
    case 'send':
      return translate('board.agents.gate.send', 'send a message')
    case 'publish':
      return translate('board.agents.gate.publish', 'publish')
    case 'delete':
      return translate('board.agents.gate.delete', 'delete')
    case 'download':
      return translate('board.agents.gate.download', 'download a file')
    case 'unverified':
      return translate('board.agents.gate.unverified', 'click something it could not verify')
    default:
      return kind
  }
}

function statusLabel(agent: AgentPresence): string {
  if (agent.stopped) {
    return translate('board.agents.status.stopped', 'Stopped')
  }
  if (agent.yielded) {
    return translate('board.agents.youTookOver', 'You took over')
  }
  if (agent.paused) {
    return translate('board.agents.paused', 'Paused')
  }
  if (agent.yieldedUntil !== null && agent.yieldedUntil > Date.now()) {
    return translate('board.agents.waitingForYou', 'Waiting for you')
  }
  if (agent.gated) {
    return translate('board.agents.status.needsOk', 'Waiting for your OK')
  }
  if (agent.waiting) {
    return translate('board.agents.waitingForYou', 'Waiting for you')
  }
  if (agent.thinking) {
    return translate('board.agents.status.thinking', 'Thinking')
  }
  if (agent.typing) {
    return translate('board.agents.status.typing', 'Typing')
  }
  if (agent.userState === 'away') {
    return translate('board.agents.status.away', 'Away')
  }
  if (agent.userState === 'idle') {
    return translate('board.agents.status.idle', 'Idle')
  }
  return translate('board.agents.status.working', 'Working')
}

function agentTileId(agent: AgentPresence): string | null {
  if (agent.pointer && 'tileId' in agent.pointer) {
    return agent.pointer.tileId
  }
  return agent.claimedTileId
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

function useSiteLabel(worktreeId: string | null, tileId: string | null): string {
  return useAppStore((s) => {
    const card = tileId ? getBoard(s, worktreeId).cards.find((c) => c.id === tileId) : undefined
    if (!card) {
      return translate('board.agents.thisTile', 'this tile')
    }
    return (card.kind === 'web' ? hostnameOf(card.url) : null) ?? card.title
  })
}

function ApprovalCard({
  agent,
  worktreeId
}: {
  agent: AgentPresence
  worktreeId: string | null
}): React.JSX.Element | null {
  const site = useSiteLabel(worktreeId, agentTileId(agent))
  const gated = agent.gated
  if (!gated) {
    return null
  }
  const decide = (action: 'approve' | 'deny'): void => {
    void agentControl({ agentId: agent.id, action, requestId: gated.requestId })
  }
  return (
    <div
      data-agent-approval={agent.id}
      className="mt-1 flex flex-col gap-2 rounded-[12px] border-2 p-2.5 text-[13px]"
      style={{ borderColor: agent.color }}
    >
      <span>
        {translate('board.agents.wantsTo', '{{name}} wants to {{action}} on {{site}}', {
          name: agent.name,
          action: gateLabel(gated.kind),
          site
        })}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          className="h-7 rounded-full px-3 text-[12px] font-semibold"
          style={{ background: agent.color, color: 'var(--agent-fg)' }}
          onClick={() => decide('approve')}
        >
          {translate('board.agents.approve', 'Approve')}
        </button>
        <button type="button" className={cn(ROW_BUTTON, 'h-7 px-3')} onClick={() => decide('deny')}>
          {translate('board.agents.deny', 'Deny')}
        </button>
      </div>
    </div>
  )
}

function AgentRow({
  agent,
  following,
  worktreeId
}: {
  agent: AgentPresence
  following: boolean
  worktreeId: string | null
}): React.JSX.Element {
  const control = (action: 'pause' | 'resume' | 'stop' | 'takeOver'): void => {
    void agentControl({ agentId: agent.id, action })
  }
  // Why: resume is renderer-only now, so a stopped agent must be resumable from here.
  const resumable = agent.paused || agent.yielded || agent.stopped
  return (
    <div data-agent-row={agent.id} className="flex flex-col">
      <div className="flex h-8 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: agent.stopped ? 'var(--agent-muted)' : agent.color }}
        />
        <span className="max-w-[120px] truncate text-[13px] font-semibold">{agent.name}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--board-text-muted)]">
          {statusLabel(agent)}
        </span>
        {agent.stopped ? (
          <button type="button" className={ROW_BUTTON} onClick={() => removeAgent(agent.id)}>
            {translate('board.agents.dismiss', 'Dismiss')}
          </button>
        ) : null}
        <button
          type="button"
          className={ROW_BUTTON}
          onClick={() => control(resumable ? 'resume' : 'pause')}
        >
          {resumable
            ? translate('board.agents.resume', 'Resume')
            : translate('board.agents.pause', 'Pause')}
        </button>
        <button
          type="button"
          className={ROW_BUTTON}
          disabled={agent.stopped}
          onClick={() => control('stop')}
        >
          {translate('board.agents.stop', 'Stop')}
        </button>
        <button
          type="button"
          className={ROW_BUTTON}
          disabled={agent.stopped || agent.yielded}
          onClick={() => control('takeOver')}
        >
          {translate('board.agents.takeOver', 'Take over')}
        </button>
        <button
          type="button"
          aria-pressed={following}
          className={cn(ROW_BUTTON, following && 'bg-[var(--board-panel-2)]')}
          disabled={agent.stopped}
          onClick={() => (following ? stopFollowingByUser() : setFollowedAgent(agent.id))}
        >
          {following
            ? translate('board.agents.unfollow', 'Unfollow')
            : translate('board.agents.follow', 'Follow')}
        </button>
      </div>
      <ApprovalCard agent={agent} worktreeId={worktreeId} />
    </div>
  )
}

/** Keeps the camera on the followed agent's tile until the human pans. */
function useFollowCamera(followed: AgentPresence | null, worktreeId: string | null): void {
  const followId = followed?.id ?? null
  const tileId = followed ? agentTileId(followed) : null
  useEffect(() => {
    if (followId && worktreeId && tileId) {
      focusBoardCard(worktreeId, tileId)
    }
  }, [followId, worktreeId, tileId])
  // Why: the listener stays on so auto-follow knows when the user last moved
  // the camera; while following, the same input also ends follow mode.
  useEffect(() => {
    const canvas = document.querySelector('[data-board-canvas]')
    if (!canvas) {
      return
    }
    const userMovedCamera = (): void => {
      noteUserCameraInteraction()
      if (useAgentPresence.getState().followAgentId) {
        stopFollowingByUser()
      }
    }
    // Why: a plain empty-canvas drag selects (marquee), not pans, so the canvas
    // reports pointer pans (Space+drag, middle-drag) through its own event.
    canvas.addEventListener('wheel', userMovedCamera, { capture: true, passive: true })
    canvas.addEventListener(BOARD_USER_PAN_EVENT, userMovedCamera)
    return () => {
      canvas.removeEventListener('wheel', userMovedCamera, { capture: true })
      canvas.removeEventListener(BOARD_USER_PAN_EVENT, userMovedCamera)
    }
  }, [followId])
}

export function AgentPresenceStrip({ className }: { className?: string }): React.JSX.Element | null {
  const agents = useAgentPresence((s) => s.agents)
  const followId = useAgentPresence((s) => s.followAgentId)
  const autoFollowEnabled = useAgentPresence((s) => s.autoFollowEnabled)
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const followed = followId ? (agents[followId] ?? null) : null
  useFollowCamera(followed, worktreeId)
  const list = Object.values(agents).sort((a, b) => a.name.localeCompare(b.name))
  if (list.length === 0) {
    return null
  }
  const autoFollowToggle = (
    <label className="flex h-7 items-center gap-2 text-[12px] text-[var(--board-text-muted)] select-none">
      <input
        type="checkbox"
        checked={autoFollowEnabled}
        onChange={(e) => setAutoFollowEnabled(e.target.checked)}
        className="size-3.5 accent-[var(--board-accent)]"
      />
      {translate('board.agents.autoFollow', 'Auto-follow agents')}
    </label>
  )
  return (
    <>
      {followed ? (
        <>
          <div
            data-agent-following={followed.id}
            className="pointer-events-none absolute inset-0 border-2"
            style={{ borderColor: followed.color }}
          />
          <div
            className="pointer-events-auto absolute top-[17px] left-1/2 flex h-[30px] -translate-x-1/2 items-center gap-2 rounded-full px-3 text-[12px] font-semibold"
            style={{ background: followed.color, color: 'var(--agent-fg)' }}
          >
            {translate('board.agents.following', 'Following {{name}}', { name: followed.name })}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => stopFollowingByUser()}
            >
              {translate('board.agents.stopFollowing', 'Stop')}
            </button>
          </div>
        </>
      ) : null}
      <div
        data-agent-presence-strip
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          'pointer-events-auto absolute flex w-[380px] max-w-[calc(100%-40px)] flex-col gap-0.5 rounded-[var(--board-radius-panel)] px-3 py-1.5',
          className
        )}
      >
        {list.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            following={agent.id === followId}
            worktreeId={worktreeId}
          />
        ))}
        {autoFollowToggle}
      </div>
    </>
  )
}
