import React, { useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  MEMORY_CATEGORIES,
  MEMORY_FACT_MAX,
  findByTitle,
  findDuplicate,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryProposal
} from './memory-entries'

export const FIELD =
  'w-full rounded-[8px] border border-[var(--board-panel-border)] bg-transparent px-2 py-1 text-[12px] text-[var(--board-text)]'

function categoryLabel(c: MemoryCategory): string {
  switch (c) {
    case 'architecture':
      return translate('board.memory.cat.architecture', 'Architecture')
    case 'structure':
      return translate('board.memory.cat.structure', 'Structure')
    case 'commands':
      return translate('board.memory.cat.commands', 'Commands')
    case 'conventions':
      return translate('board.memory.cat.conventions', 'Conventions')
    case 'gotchas':
      return translate('board.memory.cat.gotchas', 'Gotchas')
    case 'context':
      return translate('board.memory.cat.context', 'Context')
  }
}

export function CategorySelect({
  value,
  onChange
}: {
  value: MemoryCategory
  onChange: (c: MemoryCategory) => void
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MemoryCategory)}
      aria-label={translate('board.memory.category', 'Category')}
      className={cn(FIELD, 'w-auto')}
    >
      {MEMORY_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {categoryLabel(c)}
        </option>
      ))}
    </select>
  )
}

function AppliesTo({
  scopeKind,
  disabled,
  onMove
}: {
  scopeKind: 'repo' | 'global'
  disabled: boolean
  onMove: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 text-[11px] text-[var(--board-text-muted)]">
      <span>{translate('board.memory.appliesTo', 'Applies to')}</span>
      {(['repo', 'global'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={scopeKind === value}
          disabled={disabled || scopeKind === value}
          onClick={onMove}
          className={cn(
            'rounded-[6px] px-2 py-0.5 hover:bg-[var(--board-panel-2)] disabled:cursor-default',
            scopeKind === value && 'bg-[var(--board-accent-tint)] text-[var(--board-text)]',
            disabled && scopeKind !== value && 'opacity-40'
          )}
        >
          {value === 'repo'
            ? translate('board.memory.appliesRepo', 'This repo')
            : translate('board.memory.scopeAllRepos', 'All repos')}
        </button>
      ))}
    </div>
  )
}

export function EntryRow({
  entry,
  canRefresh,
  scopeKind,
  canMove,
  onChange,
  onDelete,
  onRefresh,
  onMove
}: {
  entry: MemoryEntry
  canRefresh: boolean
  scopeKind: 'repo' | 'global'
  /** False when there is no repo to move an all-repos fact into. */
  canMove: boolean
  onChange: (patch: Partial<MemoryEntry>) => void
  onDelete: () => void
  onRefresh: () => void
  onMove: () => void
}): React.JSX.Element {
  // Local drafts so typing doesn't write persisted UI on every keystroke; commit on blur.
  const [title, setTitle] = useState(entry.title)
  const [fact, setFact] = useState(entry.fact)
  useEffect(() => {
    setTitle(entry.title)
    setFact(entry.fact)
  }, [entry.title, entry.fact])
  return (
    <li
      className={cn(
        'space-y-1.5 rounded-[12px] border border-[var(--board-panel-border)] p-3',
        !entry.active && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2">
        <CategorySelect value={entry.category} onChange={(category) => onChange({ category })} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== entry.title && onChange({ title: title.trim() })}
          aria-label={translate('board.memory.title', 'Title')}
          className={cn(FIELD, 'flex-1 font-medium')}
        />
        <label className="flex items-center gap-1 text-[11px] text-[var(--board-text-muted)]">
          <input
            type="checkbox"
            checked={entry.active}
            onChange={(e) => onChange({ active: e.target.checked })}
          />
          {entry.active
            ? translate('board.memory.active', 'Active')
            : translate('board.memory.off', 'Off')}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!canRefresh || !entry.title.trim()}
          title={translate(
            'board.memory.refreshHint',
            'Ask an agent to re-answer this title from the repo as it is now'
          )}
          aria-label={translate('board.memory.refresh', 'Refresh this fact')}
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={translate('board.memory.delete', 'Delete fact')}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <textarea
        value={fact}
        maxLength={MEMORY_FACT_MAX}
        rows={2}
        onChange={(e) => setFact(e.target.value)}
        onBlur={() => fact.trim() && fact !== entry.fact && onChange({ fact: fact.trim() })}
        aria-label={translate('board.memory.fact', 'Fact')}
        className={cn(FIELD, 'resize-none')}
      />
      <div className="flex items-center justify-between gap-2">
        <AppliesTo scopeKind={scopeKind} disabled={!canMove} onMove={onMove} />
        <span className="text-[10px] text-[var(--board-text-muted)] tabular-nums">
          {fact.length}/{MEMORY_FACT_MAX}
        </span>
      </div>
    </li>
  )
}

export function ProposalsReview({
  proposals,
  entries,
  onAccept,
  onDrop,
  onEdit
}: {
  proposals: MemoryProposal[]
  entries: MemoryEntry[]
  onAccept: (index: number) => void
  onDrop: (index: number) => void
  onEdit: (index: number, p: MemoryProposal) => void
}): React.JSX.Element {
  return (
    <section className="space-y-2 rounded-[12px] border border-[var(--board-accent)] p-3">
      <h3 className="text-[13px] font-semibold text-[var(--board-text)]">
        {translate(
          'board.memory.proposals',
          '{{count}} proposals. Nothing is saved until you accept.',
          { count: proposals.length }
        )}
      </h3>
      <ul className="space-y-2">
        {proposals.map((p, i) => {
          const dup = findDuplicate(entries, p)
          const replaces = findByTitle(entries, p.title)
          return (
            <li key={`${i}:${p.title}`} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <CategorySelect
                  value={p.category}
                  onChange={(category) => onEdit(i, { ...p, category })}
                />
                <input
                  value={p.title}
                  onChange={(e) => onEdit(i, { ...p, title: e.target.value })}
                  className={cn(FIELD, 'flex-1 font-medium')}
                />
                <Button type="button" size="sm" onClick={() => onAccept(i)}>
                  {replaces
                    ? translate('board.memory.acceptUpdate', 'Update')
                    : translate('board.memory.accept', 'Accept')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => onDrop(i)}>
                  {translate('board.memory.drop', 'Drop')}
                </Button>
              </div>
              <textarea
                value={p.fact}
                maxLength={MEMORY_FACT_MAX}
                rows={2}
                onChange={(e) => onEdit(i, { ...p, fact: e.target.value })}
                className={cn(FIELD, 'resize-none')}
              />
              {dup ? (
                <p className="text-[11px] text-[var(--board-text-muted)]">
                  {translate(
                    'board.memory.duplicate',
                    'An equivalent fact is already in: {{title}}',
                    {
                      title: dup.title
                    }
                  )}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
