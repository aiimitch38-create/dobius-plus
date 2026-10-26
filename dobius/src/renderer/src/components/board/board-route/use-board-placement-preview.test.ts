import { describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { boardGhostOf, pushBoardGhosts, useBoardGhosts } from '../board-canvas/board-ghost-store'
import { boardSafeWorldArea } from '../board-canvas/board-reveal'
import { BOARD_CONSOLE_SIZE, boardSpawnRects } from '../board-canvas/board-spawn-placement'
import { boardInsertCard, boardInsertCardAt, boardInsertCardSize } from './board-insert-cards'
import { consoleGhosts, safeAreaCenter } from './use-board-placement-preview'

const area = { x: 0, y: 0, w: 2000, h: 1200 }

// Regression: at this window size the free-spot scan has no 900x600 slot beside
// the reserved thread rect and fell back past the right edge, so the Web tile
// rail ghost rendered mostly off-screen. The rail ghost for click-placed tools
// now previews a click in the middle of the visible area instead.
describe('Web tile rail ghost at a 1249x859 window', () => {
  const screen = { w: 1249, h: 859 }
  const viewport = { x: 0, y: 0, zoom: 1 }

  it('equals the card a click at the same point creates and sits fully on screen', () => {
    const center = safeAreaCenter(viewport, screen)
    const clicked = boardInsertCardAt('web', center, boardSafeWorldArea(viewport, screen))
    const ghost = boardGhostOf(clicked)
    expect({ x: ghost.x, y: ghost.y, w: ghost.w, h: ghost.h }).toEqual({
      x: clicked.x,
      y: clicked.y,
      w: clicked.w,
      h: clicked.h
    })
    expect(ghost).toMatchObject({ w: 900, h: 600, kind: 'web' })
    // zoom 1 at origin: world px are screen px.
    expect(ghost.x).toBeGreaterThanOrEqual(0)
    expect(ghost.y).toBeGreaterThanOrEqual(0)
    expect(ghost.x + ghost.w).toBeLessThanOrEqual(screen.w)
    expect(ghost.y + ghost.h).toBeLessThanOrEqual(screen.h)
  })

  it('stays inside the chrome-free area when the board is panned and zoomed', () => {
    const v = { x: -340, y: 120, zoom: 0.8 }
    const safe = boardSafeWorldArea(v, screen)
    const card = boardInsertCardAt('web', safeAreaCenter(v, screen), safe)
    expect(card.x).toBeGreaterThanOrEqual(safe.x)
    expect(card.y).toBeGreaterThanOrEqual(safe.y)
    expect(card.x + card.w).toBeLessThanOrEqual(safe.x + safe.w + 1e-9)
    expect(card.y + card.h).toBeLessThanOrEqual(safe.y + safe.h + 1e-9)
  })

  it('placing the tile adds exactly one card inside the ghost and leaves the zoom alone', () => {
    const WT = 'wt-ghost-place'
    useBoardGhosts.setState({ ghosts: [], preview: [] })
    const state = useAppStore.getState()
    const before = getBoard(state, WT).viewport
    const placed = boardInsertCardAt('web', safeAreaCenter(before, screen), boardSafeWorldArea(before, screen))
    // Same steps as BoardRoute.placeInsertCard.
    const cardId = state.addCard(WT, placed)
    pushBoardGhosts([boardGhostOf(placed, cardId)])
    const after = getBoard(useAppStore.getState(), WT)
    expect(after.cards).toHaveLength(1)
    expect(after.cards[0]).toMatchObject({ kind: 'web', x: placed.x, y: placed.y, w: 900, h: 600 })
    expect(after.viewport).toEqual(before)
    expect(after.viewport.zoom).toBe(1)
  })
})

describe('placement preview shares the click placement', () => {
  it('a console ghost sits exactly where the spawn path puts the card', () => {
    const center = { x: 500, y: 300 }
    const [ghost] = consoleGhosts(center, 1, 'claude')
    const [card] = boardSpawnRects(center, 1)
    expect(ghost).toEqual({ ...card, kind: 'console', agent: 'claude' })
    expect(ghost.w).toBe(BOARD_CONSOLE_SIZE.w)
    expect(ghost.h).toBe(BOARD_CONSOLE_SIZE.h)
  })

  it('ghosts a Spawn 4 block one per console', () => {
    const ghosts = consoleGhosts({ x: 0, y: 0 }, 4, 'codex')
    expect(ghosts.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual(boardSpawnRects({ x: 0, y: 0 }, 4))
    expect(ghosts.every((g) => g.kind === 'console' && g.agent === 'codex')).toBe(true)
  })

  it('a web ghost at a canvas point matches the card the click creates', () => {
    const world = { x: 700, y: 500 }
    const card = boardInsertCardAt('web', world, area)
    const ghost = boardGhostOf(card)
    expect(ghost).toMatchObject({ x: card.x, y: card.y, w: 900, h: 600, kind: 'web' })
    expect({ w: card.w, h: card.h }).toEqual(boardInsertCardSize('web'))
  })

  it('a web tile clicked near the top edge is clamped, ghost and card alike', () => {
    const card = boardInsertCardAt('web', { x: 100, y: 10 }, area)
    expect(card.x).toBe(0)
    expect(card.y).toBe(0)
    expect(boardGhostOf(card)).toMatchObject({ x: 0, y: 0, w: 900, h: 600 })
  })

  it('the rail hover ghost for a to-do list is the checklist card rect', () => {
    const center = { x: 400, y: 400 }
    const card = boardInsertCard('todo', center)
    expect(boardGhostOf(card)).toEqual({
      x: card.x,
      y: card.y,
      w: 280,
      h: 320,
      kind: 'checklist',
      agent: undefined,
      cardId: undefined
    })
  })
})
