import React from 'react'
import { Pipette } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_FLOATING_PANEL_CLASS } from '../board-chrome/board-surface-classes'
import { isBoardCustomColor, type BoardCustomColor } from './board-tool-style'

// Chromium's EyeDropper (Electron has it); absent from the TS DOM lib.
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
function eyeDropper(): EyeDropperCtor | undefined {
  return (window as Window & { EyeDropper?: EyeDropperCtor }).EyeDropper
}

export function ToolPanelFrame({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-label={label}
      className={cn(
        BOARD_FLOATING_PANEL_CLASS,
        'flex w-[300px] flex-col gap-4 rounded-[var(--board-radius-panel)] p-4'
      )}
    >
      {children}
    </div>
  )
}

export function ToolPanelSection({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

const OPTION_CLASS =
  'flex h-9 items-center justify-center rounded-[10px] border border-transparent bg-[var(--board-panel-2)] text-[var(--board-text)] hover:border-[var(--board-panel-border)] aria-pressed:border-[var(--board-accent)] aria-pressed:bg-[var(--board-accent-tint)] aria-pressed:text-[var(--board-accent)]'

/** One row of mutually exclusive options (stroke width, style, edges, …). */
export function ToolOptionRow<T extends string>({
  options,
  value,
  onChange,
  label,
  render
}: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  label: (option: T) => string
  render: (option: T) => React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          aria-label={label(option)}
          title={label(option)}
          onClick={() => onChange(option)}
          className={OPTION_CLASS}
        >
          {render(option)}
        </button>
      ))}
    </div>
  )
}

const SWATCH_CLASS =
  'relative size-7 shrink-0 rounded-full border border-[var(--board-panel-border)] outline-offset-2 aria-pressed:outline-2 aria-pressed:outline-[var(--board-accent)]'

/** Color dots for token choices plus an eyedropper that yields a custom #hex. */
export function ToolColorRow<T extends string>({
  options,
  value,
  onChange,
  css,
  label
}: {
  options: readonly T[]
  value: T | BoardCustomColor
  onChange: (value: T | BoardCustomColor) => void
  css: (option: T | BoardCustomColor) => string
  label: (option: T) => string
}): React.JSX.Element {
  const EyeDropper = eyeDropper()
  const custom = isBoardCustomColor(value) ? value : null
  const pickLabel = translate('board.toolPanel.eyedropper', 'Pick a color from the screen')
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          aria-label={label(option)}
          title={label(option)}
          onClick={() => onChange(option)}
          className={SWATCH_CLASS}
          style={{ background: css(option) }}
        >
          {option === 'none' ? (
            <span
              aria-hidden
              className="absolute top-1 bottom-1 left-1/2 w-0.5 -translate-x-1/2 rotate-45 rounded-full bg-[var(--board-danger-text)]"
            />
          ) : null}
        </button>
      ))}
      {EyeDropper ? (
        <button
          type="button"
          aria-pressed={custom !== null}
          aria-label={pickLabel}
          title={custom ?? pickLabel}
          onClick={() => {
            new EyeDropper().open().then(
              (result) => {
                if (isBoardCustomColor(result.sRGBHex)) {
                  onChange(result.sRGBHex)
                }
              },
              () => {
                // The user dismissed the picker (Esc); keep the current color.
              }
            )
          }}
          className={cn(SWATCH_CLASS, 'flex items-center justify-center')}
          style={custom ? { background: custom } : undefined}
        >
          <Pipette
            className={cn(
              'size-3.5',
              custom ? 'text-[var(--board-panel)] mix-blend-difference' : 'text-[var(--board-text)]'
            )}
          />
        </button>
      ) : null}
    </div>
  )
}

export function ToolOpacityRow({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={10}
        max={100}
        step={5}
        value={value}
        aria-label={translate('board.toolPanel.opacity', 'Opacity')}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-[var(--board-accent)]"
      />
      <span className="w-10 text-right font-mono text-[12px] text-[var(--board-text-muted)] tabular-nums">
        {value}%
      </span>
    </div>
  )
}
