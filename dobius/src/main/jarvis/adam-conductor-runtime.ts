// The live runtime behind the conductor: the same agent status, terminal read
// (transcript + screen) and terminal list `dobius terminal` serves.
import { basename } from 'node:path'
import type {
  RuntimeTerminalAgentStatus,
  RuntimeTerminalRead
} from '../../shared/runtime-types'
import type { AdamConductor } from './adam-conductor'
import type { ConductorDeps, ConductorRead } from './adam-conductor-types'
import { QuickHandCancelled, QuickHandRefused, type QuickHandsDeps } from './live-voice-quick-hands'
import { paneSpotsOf, quickTerminalOf, type QuickHandsRuntime } from './live-voice-quick-hands-runtime'

export type ConductorRuntime = {
  listTerminals: QuickHandsRuntime['listTerminals']
  readTerminal: (
    handle: string,
    opts?: { limit?: number; screen?: boolean; transcript?: boolean; transcriptLimit?: number }
  ) => Promise<RuntimeTerminalRead>
  getTerminalAgentStatus: (handle: string) => Promise<RuntimeTerminalAgentStatus>
}

const LIST_LIMIT = 1_000
const TRANSCRIPT_MESSAGES = 4

/** What the agent last said: its transcript's last reply, and the visible screen. */
export function conductorReadOf(read: RuntimeTerminalRead): ConductorRead {
  const transcript = read.transcript
  const replies =
    transcript?.available === true
      ? transcript.messages.filter((message) => message.role === 'assistant')
      : []
  const last = replies.at(-1)
  return {
    reply: last ? { text: last.text, at: last.timestamp } : null,
    screen: read.screen?.available === true ? read.screen.screen : []
  }
}

export function createRuntimeConductorDeps(
  getRuntime: () => ConductorRuntime | null
): Pick<ConductorDeps, 'status' | 'read' | 'identify'> {
  const runtime = (): ConductorRuntime => {
    const current = getRuntime()
    if (!current) {
      throw new Error('runtime not ready')
    }
    return current
  }
  return {
    status: async (handle) => {
      const { isRunningAgent, status } = await runtime().getTerminalAgentStatus(handle)
      return { isRunningAgent, status }
    },
    read: async (handle) =>
      conductorReadOf(
        await runtime().readTerminal(handle, {
          limit: 1,
          screen: true,
          transcript: true,
          transcriptLimit: TRANSCRIPT_MESSAGES
        })
      ),
    identify: async (handle) => {
      const result = await runtime().listTerminals(undefined, LIST_LIMIT)
      const summary = result.terminals.find((terminal) => terminal.handle === handle)
      if (!summary) {
        return null
      }
      return {
        agentName: typeof summary.name === 'string' ? summary.name : null,
        project: summary.worktreePath ? basename(summary.worktreePath) : null,
        // Display only: the thread may show it; speech never does.
        title: quickTerminalOf(summary, paneSpotsOf(result.visualLayouts).get(handle)).name
      }
    }
  }
}

/** Quick hands that also tell the conductor which terminal ADAM typed into. */
export function trackedQuickHands(
  hands: QuickHandsDeps,
  conductor: () => AdamConductor | null
): QuickHandsDeps {
  return {
    ...hands,
    typeInto: async (handle, text, isCurrent) => {
      try {
        await hands.typeInto(handle, text, isCurrent)
      } catch (error) {
        // Why tracked anyway: any error but a refusal may have left part of the text typed.
        if (!(error instanceof QuickHandRefused || error instanceof QuickHandCancelled)) {
          conductor()?.noteDispatch(handle, text, 'quick-hands')
        }
        throw error
      }
      conductor()?.noteDispatch(handle, text, 'quick-hands')
    }
  }
}
