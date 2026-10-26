import React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { BoardState } from '@/store/slices/board'
import type { LoopFormValues } from './loop-form'

// Shared classes and tiny pieces of the loop form (Board tokens only).

export const SECTION_LABEL_CLASS =
  'text-[11px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase'
export const TEXTAREA_CLASS =
  'min-h-20 w-full resize-y rounded-[10px] border border-[var(--board-panel-border)] bg-[var(--board-panel)] px-3 py-2 text-[13px] text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)] focus-visible:border-[var(--board-accent)] focus-visible:ring-2 focus-visible:ring-[var(--board-accent-tint)]'
export const INPUT_CLASS =
  'h-9 rounded-[10px] border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[13px] text-[var(--board-text)] focus-visible:border-[var(--board-accent)] focus-visible:ring-[var(--board-accent-tint)]'
export const SELECTED_CARD_CLASS = 'border-[var(--board-accent)] bg-[var(--board-accent-tint)]'
export const IDLE_CARD_CLASS =
  'border-[var(--board-panel-border)] bg-[var(--board-panel)] hover:border-[var(--board-text-muted)]'
export const PILL_CLASS =
  'h-8 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
export const PILL_ON_CLASS =
  'border-[var(--board-accent)] bg-[var(--board-accent)] text-[var(--board-accent-fg)]'
export const PILL_OFF_CLASS =
  'border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[var(--board-text)] hover:border-[var(--board-text-muted)]'

export type SetField = <K extends keyof LoopFormValues>(key: K, value: LoopFormValues[K]) => void
export type BoardShape = Pick<BoardState, 'cards' | 'groups'>

export function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className={SECTION_LABEL_CLASS}>{children}</h3>
}

export function Hint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-[12px] leading-snug text-[var(--board-text-muted)]">{children}</p>
}

export function SmallNumber({
  value,
  min,
  suffix,
  label,
  onChange
}: {
  value: number
  min: number
  suffix: string
  label: string
  onChange: (n: number) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-[var(--board-text)]">
      <Input
        type="number"
        min={min}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={cn(INPUT_CLASS, 'h-8 w-24 font-mono')}
      />
      <span className="text-[var(--board-text-muted)]">{suffix}</span>
    </label>
  )
}
