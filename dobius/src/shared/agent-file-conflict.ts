// Why: IPC errors reach the renderer as a wrapped message string, so the
// conflict is recognised by this marker rather than by error class.
export const AGENT_FILE_CONFLICT_MARKER = 'AGENT_FILE_CONFLICT'

export function agentFileConflictMessage(fileName: string): string {
  return `${AGENT_FILE_CONFLICT_MARKER}: ${fileName} changed on disk since it was loaded; not overwritten`
}

export function isAgentFileConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(AGENT_FILE_CONFLICT_MARKER)
}
