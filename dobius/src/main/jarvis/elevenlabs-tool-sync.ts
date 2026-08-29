import type { AdamPlugin } from './plugin-loader'
import { PLUGIN_TOOL_PREFIX, pluginToolName } from './plugin-loader'
import type { ClientToolConfig, ToolSummary } from './elevenlabs-tools'
import {
  createClientTool,
  deleteClientTool,
  getAgentPrompt,
  listClientTools,
  setAgentToolIds,
  updateClientTool
} from './elevenlabs-tools'

export type ToolSyncPlan = {
  create: ClientToolConfig[]
  update: { id: string; config: ClientToolConfig }[]
  remove: ToolSummary[]
}

export type ToolSyncReport = {
  created: string[]
  updated: string[]
  removed: string[]
  errors: string[]
}

/** A plugin as the agent should see it. */
export function pluginToolConfig(plugin: AdamPlugin): ClientToolConfig {
  return {
    name: pluginToolName(plugin.name),
    description: plugin.description,
    expects_response: true,
    parameters: plugin.parameters
  }
}

export function isPluginTool(name: string): boolean {
  return name.startsWith(PLUGIN_TOOL_PREFIX)
}

/**
 * True when the registered tool no longer matches the plugin.
 *
 * Plain `JSON.stringify` on `parameters` is deliberate: the remote config was
 * created from this same local shape, so key order matches. If it ever did not,
 * the only cost is one idempotent PATCH — a false "changed" is harmless, while
 * a canonical sorted comparison is a dozen lines guarding a problem that has
 * not happened.
 */
function differs(remote: ToolSummary, config: ClientToolConfig): boolean {
  return (
    (remote.description ?? '') !== config.description ||
    JSON.stringify(remote.parameters ?? null) !== JSON.stringify(config.parameters)
  )
}

/**
 * Works out what to create, update and delete. Pure — no network, no clock.
 *
 * **Ownership is decided by the `plugin_` prefix, never by a list of protected
 * names.** Remote tools are filtered to that prefix BEFORE deletions are
 * computed, so a tool this build did not create is never a deletion candidate
 * in the first place. A hardcoded "protect these five" list is what
 * `agent-context.ts:12-18` records this codebase being burned by, and here the
 * drift would delete a working tool off a live account.
 */
export function planToolSync(plugins: AdamPlugin[], remoteTools: ToolSummary[]): ToolSyncPlan {
  const configs = plugins.map(pluginToolConfig)
  const ours = remoteTools.filter((tool) => isPluginTool(tool.name))
  const byName = new Map(ours.map((tool) => [tool.name, tool]))

  const create: ClientToolConfig[] = []
  const update: { id: string; config: ClientToolConfig }[] = []
  for (const config of configs) {
    const existing = byName.get(config.name)
    if (!existing) {
      create.push(config)
    } else if (differs(existing, config)) {
      update.push({ id: existing.id, config })
    }
  }

  const wanted = new Set(configs.map((config) => config.name))
  const remove = ours.filter((tool) => !wanted.has(tool.name))
  return { create, update, remove }
}

/**
 * Reads the account, plans, and applies. Never throws: this runs at startup
 * behind a `void`, and every failure is collected into the report.
 */
export async function syncPluginTools(
  apiKey: string,
  agentId: string,
  plugins: AdamPlugin[],
  fetchImpl: typeof fetch = fetch
): Promise<ToolSyncReport> {
  const report: ToolSyncReport = { created: [], updated: [], removed: [], errors: [] }
  if (!apiKey.trim() || !agentId.trim()) {
    return report
  }

  const remote = await listClientTools(apiKey, fetchImpl)
  if (!remote.ok) {
    report.errors.push(`list tools: ${remote.error}`)
    return report
  }

  return applyToolSync(apiKey, agentId, planToolSync(plugins, remote.value), fetchImpl)
}

/**
 * Executes an already-computed plan.
 *
 * Split out from `syncPluginTools` so the prefix guard below can be driven with
 * a plan the planner would never produce. Folded into the caller, the only way
 * to reach that guard would be to break the planner first — which makes the
 * guard's test a test of the planner instead, and the second layer would go
 * unproven.
 */
export async function applyToolSync(
  apiKey: string,
  agentId: string,
  plan: ToolSyncPlan,
  fetchImpl: typeof fetch = fetch
): Promise<ToolSyncReport> {
  const report: ToolSyncReport = { created: [], updated: [], removed: [], errors: [] }
  const createdIds: string[] = []
  const removedIds: string[] = []

  for (const config of plan.create) {
    const made = await createClientTool(apiKey, config, fetchImpl)
    if (made.ok) {
      createdIds.push(made.value)
      report.created.push(config.name)
    } else {
      report.errors.push(`create ${config.name}: ${made.error}`)
    }
  }

  for (const item of plan.update) {
    const done = await updateClientTool(apiKey, item.id, item.config, fetchImpl)
    if (done.ok) {
      report.updated.push(item.config.name)
    } else {
      report.errors.push(`update ${item.config.name}: ${done.error}`)
    }
  }

  for (const tool of plan.remove) {
    // The prefix is checked AGAIN here, immediately before the only destructive
    // call in this build. The planner already filters by it; this is the second
    // layer, so a future edit to the planner cannot reach the API without
    // passing the rule twice.
    if (!isPluginTool(tool.name)) {
      report.errors.push(`refused to delete ${tool.name}: not a plugin tool`)
      continue
    }
    const done = await deleteClientTool(apiKey, tool.id, fetchImpl)
    if (done.ok) {
      removedIds.push(tool.id)
      report.removed.push(tool.name)
    } else {
      report.errors.push(`delete ${tool.name}: ${done.error}`)
    }
  }

  await reconcileAgentTools(apiKey, agentId, createdIds, removedIds, report, fetchImpl)
  return report
}

/**
 * One PATCH for the whole sync, not one per tool.
 *
 * Deleted ids must come OUT of `tool_ids` as well: deleting the tool while its
 * id stays attached leaves the agent pointing at something that no longer
 * exists.
 */
async function reconcileAgentTools(
  apiKey: string,
  agentId: string,
  createdIds: string[],
  removedIds: string[],
  report: ToolSyncReport,
  fetchImpl: typeof fetch
): Promise<void> {
  if (createdIds.length === 0 && removedIds.length === 0) {
    return
  }
  const agent = await getAgentPrompt(apiKey, agentId, fetchImpl)
  if (!agent.ok) {
    report.errors.push(`read agent: ${agent.error}`)
    return
  }
  const removed = new Set(removedIds)
  const next = [...agent.value.toolIds.filter((id) => !removed.has(id)), ...createdIds]
  const deduped = [...new Set(next)]
  const patched = await setAgentToolIds(apiKey, agentId, deduped, agent.value.prompt, fetchImpl)
  if (!patched.ok) {
    report.errors.push(`attach tools: ${patched.error}`)
  }
}

/** Startup visibility, same contract as the plugin loader's own log. */
export function logToolSync(report: ToolSyncReport): void {
  if (report.created.length || report.updated.length || report.removed.length) {
    console.log(
      `[jarvis] plugin tools synced — created ${report.created.length}, updated ${report.updated.length}, removed ${report.removed.length}`
    )
  }
  for (const error of report.errors) {
    console.warn(`[jarvis] plugin tool sync: ${error}`)
  }
}
