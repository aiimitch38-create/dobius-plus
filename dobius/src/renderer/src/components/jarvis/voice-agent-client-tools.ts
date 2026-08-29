/**
 * The tools the ElevenLabs agent may invoke in this renderer.
 *
 * Why this lives outside `use-voice-agent.ts`: invariant A says the model can
 * never authorise execution of a shell command, and the only way to TEST that
 * claim is to import the map and try every tool in it. Inline inside
 * `startSession` the map was unreachable without a live conversation, so the
 * guarantee rested on nobody ever adding the wrong entry.
 *
 * The rule for anything added here: a tool may PROPOSE work and may READ state.
 * Nothing in this map may cause a queued shell command to run — that is the
 * review window's button alone. `voice-agent-client-tools.test.ts` enforces it
 * across the whole map, so a careless addition fails the suite rather than
 * shipping.
 */
export type VoiceAgentClientTools = Record<
  string,
  (parameters: Record<string, unknown>) => Promise<string>
>

export function createVoiceAgentClientTools(): VoiceAgentClientTools {
  return {
    // ADAM runs on this machine, so ElevenLabs' servers cannot reach it.
    // The agent asks, we answer locally, the agent speaks the answer.
    ask_adam: async (parameters: { request?: unknown }) => {
      const result = await window.api.jarvis.askAdamText(String(parameters?.request ?? ''))
      return result.text
    },
    // Eyes: what the user is working on right now.
    get_context: async () => window.api.jarvis.agentContext(),
    // Hands: the dobius CLI, minus destructive verbs (main enforces that).
    run_dobius: async (parameters: { command?: unknown }) =>
      window.api.jarvis.runDobius(String(parameters?.command ?? '')),
    // Self-edit: propose only. The write happens in apply_code_change,
    // which the user gates by saying "approve" or clicking Approve.
    propose_code_change: async (parameters: {
      path?: unknown
      content?: unknown
      description?: unknown
    }) => {
      const result = await window.api.jarvis.proposeSelfEdit(
        String(parameters?.path ?? ''),
        String(parameters?.content ?? ''),
        String(parameters?.description ?? '')
      )
      return result.ok
        ? `Showing the change to ${result.displayPath} for review. Proposal id ${result.id}. Ask the user to approve it.`
        : `Could not propose that change: ${result.error}`
    },
    apply_code_change: async (parameters: { proposal_id?: unknown }) => {
      const result = await window.api.jarvis.applySelfEdit(String(parameters?.proposal_id ?? ''))
      return result.ok ? `Applied to ${result.displayPath}.` : `Not applied: ${result.error}`
    },
    // Memory Adam keeps himself, as opposed to the conversation summaries
    // ElevenLabs returns. Both confirm rather than failing silently.
    remember: async (parameters: { category?: unknown; key?: unknown; value?: unknown }) =>
      window.api.jarvis.remember(
        String(parameters?.category ?? ''),
        String(parameters?.key ?? ''),
        String(parameters?.value ?? '')
      ),
    forget: async (parameters: { key?: unknown }) =>
      window.api.jarvis.forget(String(parameters?.key ?? '')),
    /**
     * Shell: propose ONLY.
     *
     * There is deliberately no companion "approve" tool. Read-only commands
     * come back with their output; anything that writes is queued and this
     * returns a sentence telling the agent to ask the user to click Run. The
     * pending id is not in that sentence, so the model has no handle to run it
     * even if a tool were added.
     */
    propose_shell: async (parameters: { command?: unknown }) =>
      window.api.jarvis.proposeShell(String(parameters?.command ?? ''))
  } as VoiceAgentClientTools
}
