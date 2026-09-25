// @vitest-environment happy-dom

/* BUILD-041 (X6): no generation pipeline exists, so the dock's Generate must say so
 * instead of looking like it runs something. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { StudioCanvas } from './StudioCanvas'

afterEach(cleanup)

describe('StudioCanvas Generate', () => {
  it('is disabled and labeled not available yet', () => {
    const onAdd = vi.fn()
    render(
      <StudioCanvas
        panels={[]}
        selectedId={null}
        zoom={1}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onAdd={onAdd}
        onAction={vi.fn()}
        onImport={vi.fn()}
        resources={[]}
        onResource={vi.fn()}
      />
    )
    const button = screen.getByRole('button', { name: /Generate/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Not available yet')
    fireEvent.click(button)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
