export type BoardContextConsole = { name: string; agent: string; status: string }
export type BoardContextGroup = { name: string; members: readonly string[] }

export type BoardContextInput = {
  workspace: string
  consoles: readonly BoardContextConsole[]
  groups: readonly BoardContextGroup[]
}

const MAX_LISTED = 24

// Why: the conductor only sees text, so it gets a short plain summary of the
// board ahead of the user's words; capped so a huge board can't flood the prompt.
export function buildBoardConductorTranscript(input: BoardContextInput, text: string): string {
  const lines = [`[Dobius Board] Workspace: ${input.workspace}`]
  if (input.consoles.length === 0) {
    lines.push('Consoles: none')
  } else {
    lines.push(`Consoles (${input.consoles.length}):`)
    for (const c of input.consoles.slice(0, MAX_LISTED)) {
      lines.push(`- ${c.name} (${c.agent}, ${c.status})`)
    }
    if (input.consoles.length > MAX_LISTED) {
      lines.push(`- …and ${input.consoles.length - MAX_LISTED} more`)
    }
  }
  if (input.groups.length > 0) {
    lines.push('Groups:')
    for (const g of input.groups.slice(0, MAX_LISTED)) {
      lines.push(`- ${g.name}: ${g.members.join(', ') || 'empty'}`)
    }
  }
  lines.push('', `User: ${text}`)
  return lines.join('\n')
}
