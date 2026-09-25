import { useEffect, type MutableRefObject } from 'react'
import type { AgentRunEvent, CustomAgent } from '../../../../shared/agents'
import { agentToDraft, type AgentDraft } from './agent-page-state'

export function useSelectedAgentSync(args: {
  selectedAgent: CustomAgent | null
  selectedAgentId: string | null
  selectedAgentIdRef: MutableRefObject<string | null>
  setDraft: (draft: AgentDraft) => void
  setTranscript: (events: AgentRunEvent[]) => void
}): void {
  const { selectedAgent, selectedAgentId, selectedAgentIdRef, setDraft, setTranscript } = args

  useEffect(() => {
    setDraft(agentToDraft(selectedAgent))
    // Why: a tagline save replaces the agent object mid-run; only switching to a
    // different agent may clear the live transcript (#41).
    if (selectedAgentIdRef.current !== selectedAgentId) {
      selectedAgentIdRef.current = selectedAgentId
      setTranscript([])
    }
  }, [selectedAgent, selectedAgentId, selectedAgentIdRef, setDraft, setTranscript])
}
