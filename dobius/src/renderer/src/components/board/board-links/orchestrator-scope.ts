// What an orchestrator card may do with a typed message. Each refusal executes
// nothing; the main command bar keeps workspace and undo/redo actions.
import { translate } from '@/i18n/i18n'

export type ScopedConsole = { cardId: string; title: string }

export type OrchestratorRoute =
  | { kind: 'all'; text: string }
  | { kind: 'one'; cardId: string; text: string }
  | { kind: 'refuse'; reason: 'outside-scope' | 'workspace' | 'undo' | 'nothing-wired' }

const WORKSPACE_ACTION =
  /^(open|new|create|close|rename|switch( to)?|go to)\s+(the\s+|a\s+)?(next\s+|previous\s+)?(workspace|board tab)\b/i
const UNDO_ACTION = /^(undo|redo)\b/i

/**
 * `@Name rest` targets one wired console (longest title match wins);
 * anything else goes to every wired console.
 */
export function routeOrchestratorMessage(
  raw: string,
  wired: readonly ScopedConsole[]
): OrchestratorRoute {
  const text = raw.trim()
  if (WORKSPACE_ACTION.test(text)) {
    return { kind: 'refuse', reason: 'workspace' }
  }
  if (UNDO_ACTION.test(text)) {
    return { kind: 'refuse', reason: 'undo' }
  }
  if (text.startsWith('@')) {
    const after = text.slice(1).toLowerCase()
    const match = [...wired]
      .sort((a, b) => b.title.length - a.title.length)
      .find((c) => {
        const title = c.title.toLowerCase()
        return (
          after.startsWith(title) &&
          (after.length === title.length || /\s/.test(after[title.length]))
        )
      })
    if (!match) {
      return { kind: 'refuse', reason: 'outside-scope' }
    }
    const body = text.slice(1 + match.title.length).trim()
    return body
      ? { kind: 'one', cardId: match.cardId, text: body }
      : { kind: 'refuse', reason: 'outside-scope' }
  }
  return wired.length === 0 ? { kind: 'refuse', reason: 'nothing-wired' } : { kind: 'all', text }
}

export function orchestratorRefusalText(
  reason: Extract<OrchestratorRoute, { kind: 'refuse' }>['reason']
): string {
  switch (reason) {
    case 'outside-scope':
      return translate(
        'board.orchestrator.refuseScope',
        'That console isn’t wired to this card, so nothing was sent. Tap Connect to wire it.'
      )
    case 'workspace':
      return translate(
        'board.orchestrator.refuseWorkspace',
        'Workspaces are managed from the main command bar, not from an orchestrator card.'
      )
    case 'undo':
      return translate(
        'board.orchestrator.refuseUndo',
        'Undo and redo work from the main command bar only.'
      )
    case 'nothing-wired':
      return translate(
        'board.orchestrator.refuseNothingWired',
        'No consoles are wired yet. Tap Connect, or spawn one with +.'
      )
  }
}
