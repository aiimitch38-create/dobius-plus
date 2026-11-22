// Which tool calls are known to stay on this Mac. An ALLOW list on purpose:
// anything not named here (a new connector, an unknown command, a script)
// counts as outward, and a run that used one is never retried. Pure; used by
// the run loop (main/agents/agent-run-loop.ts).

import { isToolingPath, judgeBashCommand } from './agent-run-local-bash'

// `Task` / `Agent` are deliberately absent: a subagent's own tool calls are
// not classified, so a run that delegated cannot be proven local.
const READ_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Grep',
  'Glob',
  'TodoWrite',
  'mcp__dobius__read_knowledge',
  'mcp__dobius__list_crew',
  'mcp__dobius__crew_status'
])
const FILE_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'NotebookEdit'])

// A `tool_progress` tick reuses the tool-use event with only an elapsed time
// ("12s"); the tool's real input was already judged on its own event.
const PROGRESS_TICK = /^\d+s$/

function inputField(detail: string | undefined, fields: readonly string[]): string | null {
  if (!detail) {
    return null
  }
  try {
    const input: unknown = JSON.parse(detail)
    if (typeof input !== 'object' || input === null) {
      return null
    }
    for (const field of fields) {
      const value = (input as Record<string, unknown>)[field]
      if (typeof value === 'string' && value) {
        return value
      }
    }
    return null
  } catch {
    // Not the JSON a tool call carries: its input cannot be read.
    return null
  }
}

export type LocalToolTracker = {
  /**
   * Judges one tool-use event of a run, in order. False = the call may have
   * acted outside this Mac. `detail` is the event's detail (the input as JSON).
   */
  isLocal: (toolName: string | undefined, detail?: string) => boolean
}

/**
 * One per run. It remembers whether the run changed the files that decide what
 * git, the package manager and the check tools execute (.git, node_modules,
 * package.json, tool config). After such a change, running one of those tools
 * runs code nobody reviewed, so it stops counting as local.
 */
export function createLocalToolTracker(): LocalToolTracker {
  let toolingChanged = false
  return {
    isLocal: (toolName, detail) => {
      if (!toolName) {
        return false
      }
      if (READ_TOOLS.has(toolName)) {
        return true
      }
      if (FILE_WRITE_TOOLS.has(toolName)) {
        const filePath = inputField(detail, ['file_path', 'notebook_path'])
        // A write whose target cannot be read is assumed to be the worst case.
        if (filePath === null || isToolingPath(filePath)) {
          toolingChanged = true
        }
        return true
      }
      if (toolName !== 'Bash') {
        return false
      }
      if (detail !== undefined && PROGRESS_TICK.test(detail)) {
        return true
      }
      const command = inputField(detail, ['command'])
      if (command === null) {
        return false
      }
      const verdict = judgeBashCommand(command)
      if (!verdict.local || (verdict.runsProjectCode && (toolingChanged || verdict.touchesToolingPath))) {
        return false
      }
      toolingChanged ||= verdict.touchesToolingPath
      return true
    }
  }
}

/** Judges a single tool call on its own, with no earlier calls to consider. */
export function isLocalOnlyToolUse(toolName: string | undefined, detail?: string): boolean {
  return createLocalToolTracker().isLocal(toolName, detail)
}
