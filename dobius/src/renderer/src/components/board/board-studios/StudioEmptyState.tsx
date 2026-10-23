import React from 'react'

// One-sentence centered message for a studio that has nothing to show yet or
// cannot run in this context. Never shows placeholder data.
export function StudioEmptyState({
  title,
  detail,
  children
}: {
  title: string
  detail?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-[15px] font-semibold text-[var(--board-text)]">{title}</p>
      {detail ? (
        <p className="max-w-md text-[13px] leading-relaxed text-[var(--board-text-muted)]">
          {detail}
        </p>
      ) : null}
      {children}
    </div>
  )
}
