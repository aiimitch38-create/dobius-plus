import { useCallback, useEffect, useId, useState } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useConsoleCardStatus } from '../console-card/use-console-card-status'
import type { BoardCable } from './board-link-geometry'
import { orchestratorCableRoute } from './orchestrator-cable-geometry'
import './orchestrator-cables.css'

type WorkingChanged = (tabId: string, working: boolean) => void

function CableTargetStatus({
  worktreeId,
  tabId,
  onWorkingChanged
}: {
  worktreeId: string
  tabId: string
  onWorkingChanged: WorkingChanged
}): null {
  const { status } = useConsoleCardStatus(worktreeId, tabId)
  const working = status === 'working'
  useEffect(() => {
    onWorkingChanged(tabId, working)
    return () => onWorkingChanged(tabId, false)
  }, [tabId, working, onWorkingChanged])
  return null
}

function OrchestratorCable({
  cable,
  zoom,
  working,
  reducedMotion,
  emphasized
}: {
  cable: BoardCable
  zoom: number
  working: boolean
  reducedMotion: boolean
  emphasized: boolean
}): React.JSX.Element {
  const pathId = useId()
  const { start, end, path } = orchestratorCableRoute(cable.from, cable.to)
  const tripSeconds = working ? 2.25 : 3
  const packetCount = working ? 3 : 1
  // Why: the SVG lives inside the canvas's CSS scale; compensate every visual
  // size so cables and plugs stay crisp in screen pixels at any viewport zoom.
  const scale = 1 / (zoom > 0 ? zoom : 1)
  return (
    <g
      className="board-orchestrator-cable"
      data-working={working}
      opacity={emphasized || working ? 1 : 0.7}
      fill="var(--board-accent)"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--board-accent)"
        strokeWidth={10 * scale}
        strokeLinecap="round"
        opacity={0.18}
        style={{ filter: `blur(${2 * scale}px)` }}
      />
      <path
        id={pathId}
        d={path}
        fill="none"
        stroke="var(--board-accent)"
        strokeWidth={2.5 * scale}
        strokeLinecap="round"
      />
      <circle cx={start.x} cy={start.y} r={4 * scale} />
      <circle
        className="board-cable-target-pulse"
        cx={end.x}
        cy={end.y}
        r={6 * scale}
        opacity={0.25}
      />
      <circle className="board-cable-target-dot" cx={end.x} cy={end.y} r={4 * scale} />
      {!reducedMotion &&
        Array.from({ length: packetCount }, (_, index) => (
          <circle
            key={index}
            className="board-cable-packet"
            r={3 * scale}
            fill="var(--board-accent-fg)"
            stroke="var(--board-accent)"
            strokeWidth={1.5 * scale}
            opacity={working ? 1 : 0.65}
          >
            <animateMotion
              dur={`${tripSeconds}s`}
              begin={`${(-index * tripSeconds) / packetCount}s`}
              repeatCount="indefinite"
              calcMode="paced"
            >
              <mpath href={`#${pathId}`} />
            </animateMotion>
          </circle>
        ))}
    </g>
  )
}

export function OrchestratorCables({
  cables,
  worktreeId,
  zoom,
  emphasizedOrchestratorId
}: {
  cables: BoardCable[]
  worktreeId: string
  zoom: number
  emphasizedOrchestratorId?: string
}): React.JSX.Element {
  const reducedMotion = usePrefersReducedMotion()
  const [workingTabs, setWorkingTabs] = useState<ReadonlySet<string>>(() => new Set())
  const onWorkingChanged = useCallback<WorkingChanged>((tabId, working) => {
    setWorkingTabs((previous) => {
      if (previous.has(tabId) === working) {
        return previous
      }
      const next = new Set(previous)
      if (working) {
        next.add(tabId)
      } else {
        next.delete(tabId)
      }
      return next
    })
  }, [])
  const tabIds = new Set(cables.flatMap((cable) => cable.targetTabIds))
  return (
    <>
      {/* Why: one status subscription per target, even when several orchestrators wire it. */}
      {[...tabIds].map((tabId) => (
        <CableTargetStatus
          key={tabId}
          worktreeId={worktreeId}
          tabId={tabId}
          onWorkingChanged={onWorkingChanged}
        />
      ))}
      {cables.map((cable) => (
        <OrchestratorCable
          key={cable.id}
          cable={cable}
          zoom={zoom}
          working={cable.targetTabIds.some((id) => workingTabs.has(id))}
          reducedMotion={reducedMotion}
          emphasized={cable.orchestratorId === emphasizedOrchestratorId}
        />
      ))}
    </>
  )
}
