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

/**
 * Sends one plugin call to main. The only place plugin dispatch touches IPC.
 *
 * No try/catch: `runPlugin` in main already turns a throwing plugin into a
 * sentence, and an unknown tool name answers in words rather than rejecting.
 */
function dispatchPlugin(name: string): (parameters: Record<string, unknown>) => Promise<string> {
  return async (parameters) => window.api.jarvis.runPluginTool(name, parameters ?? {})
}

/**
 * The hand-written tools. Kept separate from the plugin wrapping below so the
 * five real entries stay obvious and greppable — the build file's wiring check
 * exists precisely because a catch-all can swallow them.
 */
function createBuiltInClientTools(): VoiceAgentClientTools {
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

/**
 * Every tool the agent may invoke: the built-ins, one explicit entry per loaded
 * plugin, and a fallback for any name that is still unrecognised.
 *
 * **Why both the explicit entries and the proxy.** How the ElevenLabs SDK looks
 * a tool up is not observable from here — `clientTools[name]` needs the `get`
 * trap, while enumerating `Object.keys` up front needs real entries. Nothing in
 * this build can open a live conversation to find out, and guessing wrong ships
 * a plugin system that silently never fires. Both together are correct under
 * either, for about fifteen lines.
 *
 * `ownKeys` deliberately reports only the real tools, so enumeration stays
 * honest — including for the invariant-A test, which walks the whole map.
 *
 * Invariant A still holds through the fallback: it reaches `jarvis:runPlugin`
 * and nothing else. No path here can run a queued shell command.
 */
/**
 * `then` must NEVER be dispatchable.
 *
 * Returning a function for `then` makes this object a THENABLE, and promise
 * machinery then calls it with (resolve, reject) and waits for a resolve that
 * never comes. Measured before this guard existed: `Promise.resolve(tools)`
 * hung forever. Since the map is handed to the ElevenLabs SDK inside an options
 * object, one `await` anywhere upstream would freeze the conversation at
 * startup with no error to show for it.
 *
 * Inherited keys (`toString`, `constructor`, `valueOf`) need no listing — `in`
 * walks the prototype chain, so they resolve on the target. `then` is the one
 * name that is neither inherited nor a tool. Symbols are excluded wholesale:
 * `Symbol.iterator` and friends are protocol, never tool names.
 */
const NEVER_DISPATCHED = new Set(['then'])

/**
 * Plain boolean, deliberately not a `property is string` type predicate: this
 * returns false for plenty of strings (`then`, and every real tool), so a
 * predicate would have TypeScript narrow the false branch to `symbol` — which
 * is simply untrue.
 */
function isDispatchableName(target: object, property: string | symbol): boolean {
  return typeof property === 'string' && !NEVER_DISPATCHED.has(property) && !(property in target)
}

export function createVoiceAgentClientTools(
  pluginToolNames: string[] = []
): VoiceAgentClientTools {
  const tools = createBuiltInClientTools()
  for (const name of pluginToolNames) {
    // A built-in is never shadowed by a plugin claiming its name.
    if (!(name in tools)) {
      tools[name] = dispatchPlugin(name)
    }
  }
  return new Proxy(tools, {
    get: (target, property) =>
      isDispatchableName(target, property)
        ? dispatchPlugin(String(property))
        : Reflect.get(target, property),
    has: (target, property) => isDispatchableName(target, property) || property in target,
    ownKeys: (target) => Reflect.ownKeys(target)
  })
}
