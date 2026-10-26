import React from 'react'
import { cn } from '@/lib/utils'

/** Accent switch for the loop form's STOP and BEHAVIOR rows (Board tokens only). */
export function LoopToggle({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--board-accent)] disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-[var(--board-accent)] bg-[var(--board-accent)]'
          : 'border-[var(--board-panel-border)] bg-[var(--board-panel-2)]'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-[2px] left-[2px] size-4 rounded-full shadow-sm transition-transform',
          checked
            ? 'translate-x-4 bg-[var(--board-accent-fg)]'
            : 'translate-x-0 bg-[var(--board-text-muted)]'
        )}
      />
    </button>
  )
}
