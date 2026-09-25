// @vitest-environment happy-dom

import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentRunEvent, CustomAgent } from '../../../../shared/agents'
import { agentToDraft, type AgentDraft } from './agent-page-state'
import { useSelectedAgentSync } from './use-selected-agent-sync'

let container: HTMLDivElement
let root: Root
let latest: { transcript: AgentRunEvent[]; draft: AgentDraft } | null = null
let pushEvent: ((event: AgentRunEvent) => void) | null = null

function Probe(props: { agent: CustomAgent | null }): null {
  const [transcript, setTranscript] = useState<AgentRunEvent[]>([])
  const [draft, setDraft] = useState<AgentDraft>(() => agentToDraft(null))
  const selectedAgentIdRef = useRef<string | null>(null)
  useSelectedAgentSync({
    selectedAgent: props.agent,
    selectedAgentId: props.agent?.id ?? null,
    selectedAgentIdRef,
    setDraft,
    setTranscript
  })
  pushEvent = (event) => setTranscript((events) => [...events, event])
  latest = { transcript, draft }
  return null
}

function makeAgent(description: string, id = 'agent-1'): CustomAgent {
  return { ...agentToDraft(null), id, name: 'Scout', description } as unknown as CustomAgent
}

const event = { agentId: 'agent-1', runId: 'run-1', type: 'text', text: 'hello' } as unknown as AgentRunEvent

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useSelectedAgentSync (#41)', () => {
  it('keeps the live transcript when the tagline save replaces the agent object', async () => {
    await act(async () => root.render(<Probe agent={makeAgent('old tagline')} />))
    await act(async () => pushEvent?.(event))
    expect(latest?.transcript).toHaveLength(1)

    await act(async () => root.render(<Probe agent={makeAgent('new tagline')} />))

    expect(latest?.transcript).toHaveLength(1)
    expect(latest?.draft.description).toBe('new tagline')
    await act(async () => pushEvent?.(event))
    expect(latest?.transcript).toHaveLength(2)
  })

  it('clears the transcript when a different agent is selected', async () => {
    await act(async () => root.render(<Probe agent={makeAgent('a')} />))
    await act(async () => pushEvent?.(event))
    await act(async () => root.render(<Probe agent={makeAgent('b', 'agent-2')} />))
    expect(latest?.transcript).toHaveLength(0)
  })
})
