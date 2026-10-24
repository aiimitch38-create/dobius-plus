import { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { textTailLines, type ConsoleScreen } from './console-output-tail'
import {
  consoleMiniatureStyle,
  miniatureCellBox,
  miniatureFitRows,
  miniatureRows,
  miniRunStyle,
  type ConsoleMiniatureStyle
} from './console-miniature'
import { useConsoleCardStatus } from './use-console-card-status'
import { useConsoleOutputTail } from './use-console-output-tail'

/** The miniature wired to its console's screen and reply feed; mounted only in glance mode. */
export function ConsoleGlanceView({
  worktreeId,
  tabId,
  leafId,
  title,
  onScreen,
  drawText,
  bodyHeight,
  bodyWidth
}: {
  worktreeId: string
  tabId: string
  leafId: string | null
  title: string
  /** Off-screen glances skip reading output; nobody can see them. */
  onScreen: boolean
  /** False when the card is so small on screen that text would be noise. */
  drawText: boolean
  /** Card body height in world px; 0 while unmeasured. */
  bodyHeight: number
  /** Card body width in world px; 0 while unmeasured. */
  bodyWidth: number
}): React.JSX.Element {
  const { lastReply } = useConsoleCardStatus(worktreeId, tabId)
  const settings = useAppStore((s) => s.settings)
  const style = useMemo(() => consoleMiniatureStyle(settings), [settings])
  const ptyId = useAppStore(
    (s) =>
      (leafId ? s.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[leafId] : undefined) ??
      s.ptyIdsByTabId[tabId]?.[0] ??
      null
  )
  const screen = useConsoleOutputTail(ptyId, onScreen && drawText)
  return (
    <ConsoleGlance
      title={title}
      screen={screen}
      lastReply={lastReply?.text ?? null}
      style={style}
      bodyHeight={bodyHeight}
      bodyWidth={bodyWidth}
      drawText={drawText}
    />
  )
}

type ConsoleGlanceProps = {
  title: string
  /** Styled screen rows from the terminal; null until the first read lands. */
  screen: ConsoleScreen | null
  /** The agent's last reply, shown when the screen has nothing readable yet. */
  lastReply: string | null
  style: ConsoleMiniatureStyle
  bodyHeight: number
  /** 0 while unmeasured: rows then use the font's natural width. */
  bodyWidth?: number
  drawText: boolean
}

/**
 * A proportional miniature of the terminal: its screen rows drawn as plain
 * text at the card's zoom-1 size, in the live terminal's font, padding and
 * colors, so the board's zoom shrinks it exactly like the real terminal.
 * Status lives in the title-bar pills, not here. Inert: never takes focus,
 * and a click on it is the card's click (select / fly in), not terminal input.
 */
export function ConsoleGlance({
  title,
  screen,
  lastReply,
  style,
  bodyHeight,
  bodyWidth = 0,
  drawText
}: ConsoleGlanceProps): React.JSX.Element {
  const fromScreen = screen !== null && screen.lines.length > 0
  const box = miniatureCellBox(fromScreen ? screen : null, bodyWidth, bodyHeight, style)
  const fit = miniatureFitRows(bodyHeight, {
    paddingY: style.paddingY,
    lineHeightPx: box.lineHeightPx
  })
  const screenRows = fromScreen ? miniatureRows(screen.lines, fit) : []
  const replyRows = !fromScreen && lastReply ? textTailLines(lastReply, fit) : []
  return (
    <div
      data-board-console-glance
      data-board-card-glance
      aria-label={translate('board.console.glance', 'Latest output from {{title}}', { title })}
      className="absolute inset-0 cursor-zoom-in overflow-hidden select-none"
      style={{
        background: style.background,
        color: style.foreground,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        // Why: xterm draws every glyph in its own cell; ligatures would merge cells.
        fontVariantLigatures: 'none',
        lineHeight: `${box.lineHeightPx}px`,
        padding: `${style.paddingY}px ${style.paddingX}px`
      }}
    >
      {!drawText ? null : screenRows.length > 0 ? (
        screenRows.map((runs, i) => (
          // Why: index keys are fine; the list is replaced wholesale each refresh.
          <div
            key={i}
            data-glance-row
            className="overflow-hidden whitespace-pre"
            style={
              box.cellWidthPx === null
                ? undefined
                : {
                    // Each glyph advances exactly one live cell, so a row spans
                    // the live terminal's columns and never re-wraps.
                    letterSpacing: `calc(${box.cellWidthPx}px - 1ch)`,
                    width: `${box.cellWidthPx * (screen?.cols ?? 0)}px`
                  }
            }
          >
            {runs.length === 0
              ? ' '
              : runs.map((run, j) => (
                  <span key={j} style={miniRunStyle(run, style)}>
                    {run.text}
                  </span>
                ))}
          </div>
        ))
      ) : replyRows.length > 0 ? (
        replyRows.map((line, i) => (
          <div key={i} className="break-all whitespace-pre-wrap">
            {line || ' '}
          </div>
        ))
      ) : (
        <div className="opacity-60">{translate('board.console.glanceEmpty', 'No output yet')}</div>
      )}
    </div>
  )
}
