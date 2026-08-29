import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Tool names Adam gains from plugins all carry this prefix.
 *
 * It is what makes ownership decidable by NAME rather than by a list.
 * TASK-ADAM-4.2's sync may only ever delete tools starting with it — a
 * hardcoded "protect these five" list drifts in both directions, and here the
 * drift deletes a working tool (see the same warning at `agent-context.ts:12`).
 */
export const PLUGIN_TOOL_PREFIX = 'plugin_'

/**
 * The name has to survive as an ElevenLabs tool name and as the renderer's
 * dispatch key, so it is restricted rather than merely trimmed.
 */
export const PLUGIN_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/

export type AdamPlugin = {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (parameters: Record<string, unknown>) => Promise<unknown>
  sourcePath: string
}

export type PluginLoadFailure = { file: string; reason: string }

export type PluginLoadResult = {
  plugins: AdamPlugin[]
  failures: PluginLoadFailure[]
}

export function pluginToolName(name: string): string {
  return `${PLUGIN_TOOL_PREFIX}${name}`
}

type PluginModule = {
  PLUGIN?: { name?: unknown; description?: unknown; parameters?: unknown }
  run?: unknown
}

/**
 * Validates one imported module into a plugin, or says why it is not one.
 *
 * Returned rather than thrown: one malformed file must not stop the others
 * loading, and the reason has to reach the startup log.
 */
function toPlugin(
  module: PluginModule,
  sourcePath: string,
  taken: Set<string>
): { ok: true; plugin: AdamPlugin } | { ok: false; reason: string } {
  const declared = module.PLUGIN
  if (!declared || typeof declared !== 'object') {
    return { ok: false, reason: 'no PLUGIN export' }
  }
  const name = typeof declared.name === 'string' ? declared.name.trim() : ''
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      reason: `"${name}" is not a valid plugin name (letters, digits and underscore; must not start with a digit)`
    }
  }
  if (taken.has(name)) {
    // First one wins. Silently preferring one of two identically named plugins
    // would make behaviour depend on directory order.
    return { ok: false, reason: `duplicate plugin name "${name}"` }
  }
  const description = typeof declared.description === 'string' ? declared.description.trim() : ''
  if (!description) {
    // Not cosmetic: the description is the ONLY thing telling the model when to
    // call this tool. Registering one without it produces a tool that exists,
    // costs a registration, and is never invoked — which reads as "the plugin
    // does not work" with nothing in any log to say why.
    return { ok: false, reason: `plugin "${name}" has no description` }
  }
  if (typeof module.run !== 'function') {
    return { ok: false, reason: `plugin "${name}" exports no run() function` }
  }
  return {
    ok: true,
    plugin: {
      name,
      description,
      parameters:
        declared.parameters && typeof declared.parameters === 'object'
          ? (declared.parameters as Record<string, unknown>)
          : { type: 'object', properties: {} },
      run: module.run as AdamPlugin['run'],
      sourcePath
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads `userData/adam-plugins/*.mjs` into usable plugins.
 *
 * Never throws and never rejects: this runs at startup, and an unsigned
 * third-party file must not be able to stop the app booting.
 *
 * Plugins are read once, at startup. Node caches ES modules by URL, so calling
 * this again in the same process returns the ORIGINAL module even if the file
 * changed on disk — editing a plugin needs a restart, and cache-busting with a
 * query string would leak a module per reload. Restart-only is the honest
 * contract here, not a limitation to work around.
 *
 * The import is a real runtime `import()` of a `file://` URL. The built main
 * process is CommonJS, so this is the one thing here that a bundler could
 * silently break by rewriting it to `require()` — which cannot load ESM. Unit
 * tests run under Vitest's ESM loader and would never catch that, so it is
 * checked against the built bundle instead.
 */
export async function loadAdamPlugins(directory: string): Promise<PluginLoadResult> {
  let files: string[]
  try {
    files = readdirSync(directory)
      .filter((file) => file.endsWith('.mjs'))
      .sort()
  } catch {
    // No plugin folder is the normal case, not an error.
    return { plugins: [], failures: [] }
  }

  const plugins: AdamPlugin[] = []
  const failures: PluginLoadFailure[] = []
  const taken = new Set<string>()

  for (const file of files) {
    const sourcePath = join(directory, file)
    let module: PluginModule
    try {
      module = (await import(pathToFileURL(sourcePath).href)) as PluginModule
    } catch (error) {
      failures.push({ file, reason: describeError(error) })
      continue
    }
    const result = toPlugin(module, sourcePath, taken)
    if (result.ok) {
      taken.add(result.plugin.name)
      plugins.push(result.plugin)
    } else {
      failures.push({ file, reason: result.reason })
    }
  }

  return { plugins, failures }
}

/**
 * Calls a plugin's `run`, converting a throw into text.
 *
 * Why not let it propagate: the caller is an IPC handler answering a live
 * conversation. An unhandled rejection there is a silent non-answer; a sentence
 * is something Adam can say.
 */
export async function runPlugin(
  plugin: AdamPlugin,
  parameters: Record<string, unknown>
): Promise<string> {
  try {
    const result = await plugin.run(parameters)
    return typeof result === 'string' ? result : JSON.stringify(result ?? null)
  } catch (error) {
    return `The ${plugin.name} plugin failed: ${describeError(error)}`
  }
}

/**
 * Looks a tool name up among the loaded plugins and runs it.
 *
 * Lives here rather than inline in the IPC handler so it can be tested at all:
 * `jarvis-ipc.ts` needs Electron to import, and this lookup is the only
 * judgement in the dispatch path.
 */
export async function runPluginByToolName(
  plugins: AdamPlugin[],
  toolName: string,
  parameters: Record<string, unknown>
): Promise<string> {
  const plugin = plugins.find((item) => pluginToolName(item.name) === toolName)
  if (!plugin) {
    // A sentence, not a throw: the caller is answering a live conversation, and
    // an unknown tool is something Adam should be able to say out loud.
    return `There is no plugin called ${toolName}.`
  }
  return runPlugin(plugin, parameters)
}

/** Startup visibility: nothing runs without a line naming it and where it came from. */
export function logPluginLoad(result: PluginLoadResult): void {
  for (const plugin of result.plugins) {
    console.log(`[jarvis] plugin ${plugin.name} loaded from ${plugin.sourcePath}`)
  }
  for (const failure of result.failures) {
    console.warn(`[jarvis] plugin ${failure.file} not loaded: ${failure.reason}`)
  }
}
