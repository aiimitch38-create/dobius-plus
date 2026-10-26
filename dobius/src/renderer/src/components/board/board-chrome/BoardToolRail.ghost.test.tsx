// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { boardGhostOf, setBoardGhostPreview, useBoardGhosts } from '../board-canvas/board-ghost-store'
import { BoardGhostLayer } from '../board-route/BoardGhostLayer'
import { boardInsertCard, boardInsertCardSize } from '../board-route/board-insert-cards'
import { BoardToolRail } from './BoardToolRail'

const FREE_CENTER = { x: 1000, y: 700 }

function renderRail(): void {
  render(
    <TooltipProvider>
      <BoardToolRail
        tool="select"
        onToolChange={() => {}}
        onFitView={() => {}}
        onOpenGitHub={() => {}}
        onPreview={(tool) =>
          setBoardGhostPreview(
            tool === 'web'
              ? [boardGhostOf(boardInsertCard('web', FREE_CENTER))]
              : []
          )
        }
      />
      <BoardGhostLayer zoom={1} />
    </TooltipProvider>
  )
}

describe('BoardToolRail placement ghost', () => {
  beforeEach(() => useBoardGhosts.setState({ ghosts: [], preview: [] }))
  afterEach(cleanup)

  it('hovering Web tile ghosts a 900x600 outline with the globe where the tile would land', () => {
    renderRail()
    expect(document.querySelector('[data-board-ghost]')).toBeNull()

    fireEvent.pointerEnter(screen.getByLabelText('Web tile'))
    const ghost = document.querySelector('[data-board-ghost="web"]') as HTMLElement
    expect(ghost).not.toBeNull()
    const { w, h } = boardInsertCardSize('web')
    expect(ghost.style.width).toBe(`${w}px`)
    expect(ghost.style.height).toBe(`${h}px`)
    expect(ghost.style.left).toBe(`${FREE_CENTER.x - w / 2}px`)
    expect(ghost.style.top).toBe(`${FREE_CENTER.y - h / 2}px`)
    expect(ghost.querySelector('svg.lucide-globe')).not.toBeNull()
    expect(ghost.className).toContain('border-dashed')

    fireEvent.pointerLeave(screen.getByLabelText('Web tile'))
    expect(document.querySelector('[data-board-ghost]')).toBeNull()
  })

  it('a console ghost shows the agent logo and name; a shape ghost is outline only', () => {
    renderRail()
    act(() =>
      setBoardGhostPreview([
        { x: 0, y: 0, w: 640, h: 400, kind: 'console', agent: 'claude' },
        { x: 0, y: 500, w: 160, h: 120, kind: 'shape' }
      ])
    )
    const consoleGhost = document.querySelector('[data-board-ghost="console"]') as HTMLElement
    expect(consoleGhost.textContent).toBe('Claude')
    expect(consoleGhost.querySelector('svg')).not.toBeNull()
    const shape = document.querySelector('[data-board-ghost="shape"]') as HTMLElement
    expect(shape.childElementCount).toBe(0)
  })
})
