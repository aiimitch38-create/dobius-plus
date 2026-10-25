/* Assignee normalization for persisted Kanban rows: an 'agent' assignee is
 * re-pointed at the current agents-store record when its id went stale (the
 * agent was recreated) but its name still matches. Split from the store only
 * for file size. */

import type { VertexTask } from '../../shared/vertex-task-types'
import { listAgents } from '../agents/agents-store'

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) {
    return '??'
  }
  const first = parts[0][0] ?? ''
  const second = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : (parts[0][1] ?? '')
  return `${first}${second}`.toUpperCase()
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeAgentPerson(person: VertexTask['assignee']): VertexTask['assignee'] {
  if (person?.kind !== 'agent') {
    return person
  }
  const agents = listAgents()
  if (agents.some((agent) => agent.id === person.id)) {
    return person
  }
  const wanted = normalizedKey(person.name || person.id)
  const agent = agents.find(
    (candidate) =>
      normalizedKey(candidate.name) === wanted || normalizedKey(candidate.id) === wanted
  )
  return agent
    ? { kind: 'agent', id: agent.id, name: agent.name, initials: initialsOf(agent.name) }
    : person
}
