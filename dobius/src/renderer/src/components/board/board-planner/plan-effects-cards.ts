import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type NewBoardCard } from '@/store/slices/board'
import { screenToWorld } from '../board-canvas/board-viewport'
import { consoleByName } from '../board-delivery/console-lifecycle'
import { boardInsertCard } from '../board-route/board-insert-cards'
import type { BoardEffectsContext } from './plan-effects-board'
import type { PlanEffects, StepResult } from './plan-execute'

// Plan effects that add cards (markdown, web tiles, figures, orchestrators).

const done = (text: string): StepResult => ({ ok: true, text })

function normalizeUrl(text: string): string {
  const t = text.trim()
  if (/^\d{2,5}$/.test(t)) {
    return `http://localhost:${t}`
  }
  return /^[a-z]+:\/\//i.test(t) ? t : `http://${t}`
}

export function cardEffects(
  ctx: BoardEffectsContext
): Pick<PlanEffects, 'insertMarkdown' | 'openUrl' | 'figure' | 'orchestrator'> {
  const { worktreeId } = ctx
  const state = () => useAppStore.getState()
  const board = () => getBoard(state(), worktreeId)
  const addAtFree = (card: NewBoardCard): string => {
    const center = ctx.freeCenter({ w: card.w, h: card.h })
    return state().addCard(worktreeId, {
      ...card,
      x: center.x - card.w / 2,
      y: center.y - card.h / 2
    })
  }
  return {
    insertMarkdown: async (path) => {
      addAtFree({
        kind: 'markdown',
        path,
        x: 0,
        y: 0,
        w: 640,
        h: 720,
        title: path.split(/[\\/]/).at(-1) ?? path
      })
      return done(translate('board.plan.inserted', 'Added {{name}} to the board.', { name: path }))
    },
    openUrl: async (text) => {
      const url = normalizeUrl(text)
      const center = screenToWorld(
        { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        board().viewport
      )
      const card = boardInsertCard('web', center)
      addAtFree(card.kind === 'web' ? { ...card, url } : card)
      return done(translate('board.plan.openedUrl', 'Opened {{url}} in a web tile.', { url }))
    },
    figure: async (kind, text, title) => {
      const center = { x: 0, y: 0 }
      const card: NewBoardCard =
        kind === 'note'
          ? {
              kind: 'note',
              text: text ?? '',
              color: 'yellow',
              x: 0,
              y: 0,
              w: 260,
              h: 200,
              title: translate('board.insert.note', 'Note')
            }
          : kind === 'text'
            ? ({ ...boardInsertCard('text', center), ...(text ? { text } : {}) } as NewBoardCard)
            : kind === 'todo'
              ? ({
                  ...boardInsertCard('todo', center),
                  ...(title ? { title } : {}),
                  items: (text ?? '')
                    .split('\n')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t) => ({ id: crypto.randomUUID(), text: t, done: false }))
                } as NewBoardCard)
              : ({ ...boardInsertCard(kind, center), ...(title ? { title } : {}) } as NewBoardCard)
      addAtFree(card)
      return done(translate('board.plan.added', 'Added a {{kind}}.', { kind }))
    },
    orchestrator: async (kind, consoles, name) => {
      const ids = consoles.flatMap((n) => consoleByName(worktreeId, n)?.id ?? [])
      if (kind === 'add') {
        const base = boardInsertCard('orchestrator', { x: 0, y: 0 })
        addAtFree({
          ...base,
          ...(name ? { name, title: name } : {}),
          wiredCardIds: ids
        } as NewBoardCard)
        return done(
          translate(
            'board.plan.orchAdded',
            'Added an orchestrator wired to {{count}} console(s).',
            { count: ids.length }
          )
        )
      }
      const orchs = board().cards.filter((c) => c.kind === 'orchestrator')
      const card = name
        ? orchs.find(
            (c) => c.kind === 'orchestrator' && c.name.toLowerCase() === name.toLowerCase()
          )
        : orchs[0]
      if (!card || card.kind !== 'orchestrator') {
        const base = boardInsertCard('orchestrator', { x: 0, y: 0 })
        addAtFree({ ...base, wiredCardIds: ids } as NewBoardCard)
        return done(
          translate(
            'board.plan.orchAdded',
            'Added an orchestrator wired to {{count}} console(s).',
            { count: ids.length }
          )
        )
      }
      state().updateCard(worktreeId, card.id, {
        wiredCardIds: [...new Set([...card.wiredCardIds, ...ids])]
      })
      return done(
        translate('board.plan.orchWired', 'Wired {{count}} console(s) to {{name}}.', {
          count: ids.length,
          name: card.name
        })
      )
    }
  }
}
