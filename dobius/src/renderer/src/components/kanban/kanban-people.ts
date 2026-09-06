/* Who a Vertex task can be assigned to.
 *
 * The list is the real Dobius agent roster — the same records the Agents tab
 * manages (window.api.agents.list) — plus the operator. Deliberately NOT a
 * hardcoded cast: an assignee has to be someone who can actually pick the
 * task up and run it. */

import { useEffect, useMemo, useState } from 'react'

import type { Person } from './kanban-types'

/** Two-letter monogram for an avatar with no image. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '??'
  const first = parts[0][0] ?? ''
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '')
  return `${first}${second}`.toUpperCase()
}

export const OPERATOR: Person = { kind: 'human', id: 'me', name: 'Me', initials: 'ME' }

export function useAssignablePeople(): Person[] {
  const [agents, setAgents] = useState<Person[]>([])

  useEffect(() => {
    let cancelled = false
    void window.api?.agents
      ?.list()
      .then((list) => {
        if (cancelled) return
        setAgents(
          list.map((agent) => ({
            kind: 'agent' as const,
            id: agent.id,
            name: agent.name,
            initials: initialsOf(agent.name)
          }))
        )
      })
      .catch(() => {
        // Why swallow: outside Electron (the standalone preview) there is no
        // agent roster, and the panel is still usable with just the operator.
        if (!cancelled) setAgents([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => [OPERATOR, ...agents], [agents])
}
