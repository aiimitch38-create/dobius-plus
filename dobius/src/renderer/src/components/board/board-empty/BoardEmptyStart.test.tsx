// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BoardAgentOption } from '../board-chrome/BoardAgentPicker'
import { BoardEmptyStart, type BoardEmptyStartProps } from './BoardEmptyStart'

const AGENTS: BoardAgentOption[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'aider', label: 'Aider' }
]

function renderPanel(
  overrides: Partial<BoardEmptyStartProps> = {}
): Required<Pick<BoardEmptyStartProps, 'onSelect' | 'onSpawn' | 'onPreset' | 'onDismiss'>> {
  const handlers = { onSelect: vi.fn(), onSpawn: vi.fn(), onPreset: vi.fn(), onDismiss: vi.fn() }
  render(
    <TooltipProvider>
      <BoardEmptyStart agents={AGENTS} selected="claude" {...handlers} {...overrides} />
    </TooltipProvider>
  )
  return handlers
}

afterEach(cleanup)

describe('BoardEmptyStart', () => {
  it('marks the selected tile and disables tiles for agents that are not installed', () => {
    renderPanel()
    const claude = screen.getByRole('radio', { name: 'Claude' })
    expect(claude.getAttribute('aria-checked')).toBe('true')
    expect(claude.className).toContain('border-[var(--board-accent)]')
    const grok = screen.getByRole('radio', { name: /Grok.*Not installed/ })
    expect(grok.getAttribute('aria-disabled')).toBe('true')
  })

  it('selecting an installed tile reports that agent; a disabled tile does nothing', () => {
    const { onSelect } = renderPanel()
    fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
    expect(onSelect).toHaveBeenCalledWith('codex')
    fireEvent.click(screen.getByRole('radio', { name: /Grok/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('Spawn an agent and Spawn N call the spawn path with the selected agent and count', () => {
    const { onSpawn } = renderPanel({ selected: 'codex' })
    fireEvent.click(screen.getByRole('button', { name: 'Spawn an agent' }))
    expect(onSpawn).toHaveBeenLastCalledWith('codex', 1)
    fireEvent.click(screen.getByRole('button', { name: 'Spawn 4' }))
    expect(onSpawn).toHaveBeenLastCalledWith('codex', 4)
    fireEvent.click(screen.getByRole('button', { name: 'Spawn 8' }))
    expect(onSpawn).toHaveBeenLastCalledWith('codex', 8)
  })

  it('Start from a preset and the close button reach their handlers', () => {
    const { onPreset, onDismiss } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Start from a preset' }))
    expect(onPreset).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('Enter spawns one of the selected agent and Esc dismisses, unless suspended', () => {
    const { onSpawn, onDismiss } = renderPanel()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onSpawn).toHaveBeenCalledWith('claude', 1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    cleanup()

    const suspended = renderPanel({ suspended: true })
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(suspended.onSpawn).not.toHaveBeenCalled()
    expect(suspended.onDismiss).not.toHaveBeenCalled()
  })

  it('Enter typed into a field does not spawn', () => {
    const { onSpawn } = renderPanel()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSpawn).not.toHaveBeenCalled()
    input.remove()
  })

  it('disables spawning when nothing is launchable', () => {
    renderPanel({ agents: [], selected: null })
    expect(
      (screen.getByRole('button', { name: 'Spawn an agent' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect((screen.getByRole('button', { name: 'Spawn 2' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})
