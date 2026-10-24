// Board fixtures shared by the goal card tests.
import type { BoardCard, BoardCardOf, BoardState } from '@/store/slices/board'

const base = { x: 0, y: 0, w: 100, h: 100, z: 0 }

export function consoleCard(id: string, title = id): BoardCardOf<'console'> {
  return { ...base, id, title, kind: 'console', tabId: `tab-${id}`, agentKind: 'claude' }
}

export function orchestratorCard(id: string, wiredCardIds: string[]): BoardCardOf<'orchestrator'> {
  return { ...base, id, title: id, kind: 'orchestrator', name: id, wiredCardIds }
}

export function goalCard(
  id: string,
  over: Partial<Omit<BoardCardOf<'goal'>, 'id' | 'kind'>> = {}
): BoardCardOf<'goal'> {
  return {
    ...base,
    id,
    title: 'Goal',
    kind: 'goal',
    goal: 'Ship the login page.',
    criteria: [],
    dont: [],
    reminders: { afterCompaction: true, everyTurns: 5, onNewTask: true },
    driftCheck: false,
    wiredCardIds: [],
    ...over
  }
}

export function boardOf(cards: BoardCard[], groups: BoardState['groups'] = []): BoardState {
  return { cards, groups, viewport: { x: 0, y: 0, zoom: 1 }, tool: 'select' }
}
