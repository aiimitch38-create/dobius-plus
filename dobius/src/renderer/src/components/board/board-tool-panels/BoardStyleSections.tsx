import React from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Ruler,
  Signature,
  Spline,
  type LucideIcon
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  BOARD_EDGES,
  BOARD_FILL_STYLES,
  BOARD_FILL_OPTIONS,
  BOARD_INK_TOKENS,
  BOARD_SLOPPINESS,
  BOARD_STROKE_STYLES,
  BOARD_STROKE_WIDTHS,
  BOARD_TEXT_ALIGNS,
  BOARD_TEXT_FONTS,
  BOARD_TEXT_SIZES,
  boardFillCss,
  boardFontFamily,
  boardInkCss,
  boardStrokeDashArray,
  boardStrokePx,
  type BoardCardStyle,
  type BoardSloppiness,
  type BoardTextAlign
} from './board-tool-style'
import {
  colorLabel,
  edgesLabel,
  fillStyleLabel,
  sloppinessLabel,
  strokeStyleLabel,
  strokeWidthLabel,
  textAlignLabel,
  textFontLabel,
  textSizeLabel
} from './board-tool-labels'
import {
  ToolColorRow,
  ToolOpacityRow,
  ToolOptionRow,
  ToolPanelSection
} from './BoardToolPanelControls'

// Style controls shared by the tool panels (defaults for new cards) and the
// card style editor (an existing card): both pass a style and a setter.
export type StyleBinding = {
  style: BoardCardStyle
  set: (patch: Partial<BoardCardStyle>) => void
}

const SLOPPINESS_ICONS: Record<BoardSloppiness, LucideIcon> = {
  architect: Ruler,
  artist: Spline,
  cartoonist: Signature
}
const ALIGN_ICONS: Record<BoardTextAlign, LucideIcon> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight
}

export function StrokeSections({
  style,
  set,
  withFill,
  withEdges
}: StyleBinding & { withFill: boolean; withEdges: boolean }): React.JSX.Element {
  return (
    <>
      <ToolPanelSection title={translate('board.toolPanel.stroke', 'Stroke')}>
        <ToolColorRow
          options={BOARD_INK_TOKENS}
          value={style.stroke}
          onChange={(stroke) => set({ stroke })}
          css={boardInkCss}
          label={colorLabel}
        />
      </ToolPanelSection>
      {withFill ? (
        <ToolPanelSection title={translate('board.toolPanel.background', 'Background')}>
          <ToolColorRow
            options={BOARD_FILL_OPTIONS}
            value={style.fill}
            onChange={(fill) => set({ fill })}
            css={boardFillCss}
            label={colorLabel}
          />
        </ToolPanelSection>
      ) : null}
      {withFill ? (
        <ToolPanelSection title={translate('board.toolPanel.fillStyle', 'Fill')}>
          <ToolOptionRow
            options={BOARD_FILL_STYLES}
            value={style.fillStyle}
            onChange={(fillStyle) => set({ fillStyle })}
            label={fillStyleLabel}
            render={(f) => (
              <svg aria-hidden width="18" height="18" viewBox="0 0 18 18">
                <rect
                  x="1.5"
                  y="1.5"
                  width="15"
                  height="15"
                  rx="3"
                  fill={f === 'solid' ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                {f !== 'solid' ? (
                  <path
                    d="M3 13 L13 3 M3 8 L8 3 M8 15 L15 8"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                ) : null}
                {f === 'cross-hatch' ? (
                  <path d="M5 3 L15 13 M3 5 L13 15" stroke="currentColor" strokeWidth="1.2" />
                ) : null}
              </svg>
            )}
          />
        </ToolPanelSection>
      ) : null}
      <ToolPanelSection title={translate('board.toolPanel.strokeWidth', 'Stroke width')}>
        <ToolOptionRow
          options={BOARD_STROKE_WIDTHS}
          value={style.strokeWidth}
          onChange={(strokeWidth) => set({ strokeWidth })}
          label={strokeWidthLabel}
          render={(w) => (
            <span
              aria-hidden
              className="w-8 rounded-full bg-current"
              style={{ height: boardStrokePx(w) }}
            />
          )}
        />
      </ToolPanelSection>
      <ToolPanelSection title={translate('board.toolPanel.strokeStyle', 'Stroke style')}>
        <ToolOptionRow
          options={BOARD_STROKE_STYLES}
          value={style.strokeStyle}
          onChange={(strokeStyle) => set({ strokeStyle })}
          label={strokeStyleLabel}
          render={(s) => (
            <svg aria-hidden width="56" height="6" viewBox="0 0 56 6">
              <line
                x1="3"
                y1="3"
                x2="53"
                y2="3"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={boardStrokeDashArray(s, 2.5)}
              />
            </svg>
          )}
        />
      </ToolPanelSection>
      <ToolPanelSection title={translate('board.toolPanel.sloppinessLabel', 'Sloppiness')}>
        <ToolOptionRow
          options={BOARD_SLOPPINESS}
          value={style.sloppiness}
          onChange={(sloppiness) => set({ sloppiness })}
          label={sloppinessLabel}
          render={(s) => {
            const Icon = SLOPPINESS_ICONS[s]
            return <Icon aria-hidden className="size-4" />
          }}
        />
      </ToolPanelSection>
      {withEdges ? (
        <ToolPanelSection title={translate('board.toolPanel.edgesLabel', 'Edges')}>
          <ToolOptionRow
            options={BOARD_EDGES}
            value={style.edges}
            onChange={(edges) => set({ edges })}
            label={edgesLabel}
            render={(e) => (
              <span
                aria-hidden
                className={
                  e === 'sharp'
                    ? 'size-3.5 border-2 border-current'
                    : 'size-3.5 rounded-[5px] border-2 border-dashed border-current'
                }
              />
            )}
          />
        </ToolPanelSection>
      ) : null}
      <ToolPanelSection title={translate('board.toolPanel.opacity', 'Opacity')}>
        <ToolOpacityRow value={style.opacity} onChange={(opacity) => set({ opacity })} />
      </ToolPanelSection>
    </>
  )
}

export function TextSections({ style, set }: StyleBinding): React.JSX.Element {
  return (
    <>
      <ToolPanelSection title={translate('board.toolPanel.textColor', 'Text color')}>
        <ToolColorRow
          options={BOARD_INK_TOKENS}
          value={style.stroke}
          onChange={(stroke) => set({ stroke })}
          css={boardInkCss}
          label={colorLabel}
        />
      </ToolPanelSection>
      <ToolPanelSection title={translate('board.toolPanel.fontLabel', 'Font')}>
        <div className="grid grid-cols-3 gap-1.5">
          {BOARD_TEXT_FONTS.map((font) => (
            <button
              key={font}
              type="button"
              aria-pressed={style.textFont === font}
              aria-label={textFontLabel(font)}
              title={textFontLabel(font)}
              onClick={() => set({ textFont: font })}
              style={{ fontFamily: boardFontFamily(font) }}
              className="flex h-9 items-center justify-center rounded-[10px] border border-transparent bg-[var(--board-panel-2)] text-[15px] text-[var(--board-text)] hover:border-[var(--board-panel-border)] aria-pressed:border-[var(--board-accent)] aria-pressed:bg-[var(--board-accent-tint)] aria-pressed:text-[var(--board-accent)]"
            >
              Ag
            </button>
          ))}
        </div>
      </ToolPanelSection>
      <ToolPanelSection title={translate('board.toolPanel.textSizeLabel', 'Size')}>
        <ToolOptionRow
          options={BOARD_TEXT_SIZES}
          value={style.textSize}
          onChange={(textSize) => set({ textSize })}
          label={textSizeLabel}
          render={(s) => (
            <span aria-hidden className="font-semibold">
              {s === 'small' ? 'S' : s === 'medium' ? 'M' : s === 'large' ? 'L' : 'XL'}
            </span>
          )}
        />
      </ToolPanelSection>
      <ToolPanelSection title={translate('board.toolPanel.textAlign', 'Align')}>
        <ToolOptionRow
          options={BOARD_TEXT_ALIGNS}
          value={style.textAlign}
          onChange={(textAlign) => set({ textAlign })}
          label={textAlignLabel}
          render={(a) => {
            const Icon = ALIGN_ICONS[a]
            return <Icon aria-hidden className="size-4" />
          }}
        />
      </ToolPanelSection>
      <ToolPanelSection title={translate('board.toolPanel.opacity', 'Opacity')}>
        <ToolOpacityRow value={style.opacity} onChange={(opacity) => set({ opacity })} />
      </ToolPanelSection>
    </>
  )
}
