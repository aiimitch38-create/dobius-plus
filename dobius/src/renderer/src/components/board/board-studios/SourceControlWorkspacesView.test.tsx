// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceControlWorkspacesList, type WorkspaceGitRow } from './SourceControlWorkspacesView'

const ROWS: WorkspaceGitRow[] = [
  {
    id: 'wt-api',
    name: 'API',
    branch: 'feature/api',
    purpose: 'Backend',
    changedCount: 3,
    upstream: { hasUpstream: true, ahead: 2, behind: 0 }
  },
  {
    id: 'wt-ui',
    name: 'UI',
    branch: 'feature/ui',
    purpose: 'Features',
    changedCount: 0,
    upstream: { hasUpstream: true, ahead: 0, behind: 0 }
  },
  {
    id: 'wt-misc',
    name: 'Misc',
    branch: 'misc',
    changedCount: null,
    upstream: undefined
  }
]

afterEach(() => {
  cleanup()
})

function renderList(
  activeWorktreeId: string,
  overrides: Partial<{
    collapsedGroups: ReadonlySet<string>
    onToggleGroup: (key: string) => void
    onSelect: (id: string) => void
  }> = {}
): void {
  render(
    <SourceControlWorkspacesList
      rows={ROWS}
      activeWorktreeId={activeWorktreeId}
      collapsedGroups={overrides.collapsedGroups ?? new Set()}
      onToggleGroup={overrides.onToggleGroup ?? (() => {})}
      onSelect={overrides.onSelect ?? (() => {})}
    >
      <div data-testid="panel">panel</div>
    </SourceControlWorkspacesList>
  )
}

describe('SourceControlWorkspacesList', () => {
  it('renders purpose sections in order with sync state and change counts', () => {
    renderList('wt-ui')
    const sections = screen.getAllByRole('region')
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Features',
      'Backend',
      'Other'
    ])
    expect(screen.getByText('2 ahead')).toBeTruthy()
    expect(screen.getByText('3 changed')).toBeTruthy()
    expect(screen.getByText('synced')).toBeTruthy()
    expect(screen.getByText('clean')).toBeTruthy()
    expect(screen.getByText('checking…')).toBeTruthy()
    expect(screen.getByText('Misc')).toBeTruthy()
  })

  it('expands only the active worktree row and hosts the panel under it', () => {
    renderList('wt-api')
    const apiRow = screen.getByRole('button', { name: /API/ })
    expect(apiRow.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /UI/ }).getAttribute('aria-expanded')).toBe('false')
    const panel = screen.getByTestId('panel')
    expect(apiRow.parentElement?.contains(panel)).toBe(true)
  })

  it('selecting another row reports that worktree so the panel switches to it', () => {
    const onSelect = vi.fn()
    renderList('wt-api', { onSelect })
    fireEvent.click(screen.getByRole('button', { name: /Misc/ }))
    expect(onSelect).toHaveBeenCalledWith('wt-misc')
  })

  it('collapsed groups hide their rows and the header toggles by key', () => {
    const onToggleGroup = vi.fn()
    renderList('wt-api', { collapsedGroups: new Set(['purpose:features']), onToggleGroup })
    expect(screen.queryByRole('button', { name: /UI/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Features/ }))
    expect(onToggleGroup).toHaveBeenCalledWith('purpose:features')
  })
})
