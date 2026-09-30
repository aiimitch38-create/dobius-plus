export class AgentRunCapacityError extends Error {
  constructor() {
    super('Too many concurrent agent runs')
    this.name = 'AgentRunCapacityError'
  }
}

export function isAgentRunCapacityError(error: unknown): error is AgentRunCapacityError {
  return error instanceof Error && error.name === 'AgentRunCapacityError'
}
