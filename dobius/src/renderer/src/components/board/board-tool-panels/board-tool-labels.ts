// Translated names for every tool-panel option (aria-labels and tooltips).
import { translate } from '@/i18n/i18n'
import type { BoardSwatch } from '@/store/slices/board'
import type {
  BoardEdges,
  BoardFillStyle,
  BoardInkToken,
  BoardSloppiness,
  BoardStrokeStyle,
  BoardStrokeWidth,
  BoardTextAlign,
  BoardTextFont,
  BoardTextSize,
  BoardToolShape
} from './board-tool-style'

export function shapeLabel(shape: BoardToolShape): string {
  switch (shape) {
    case 'rect':
      return translate('board.toolPanel.shape.rect', 'Rectangle')
    case 'ellipse':
      return translate('board.toolPanel.shape.ellipse', 'Ellipse')
    case 'diamond':
      return translate('board.toolPanel.shape.diamond', 'Diamond')
    case 'line':
      return translate('board.toolPanel.shape.line', 'Line')
    case 'arrow':
      return translate('board.toolPanel.shape.arrow', 'Arrow')
    case 'sticky':
      return translate('board.toolPanel.shape.sticky', 'Sticky')
  }
}

export function colorLabel(color: BoardInkToken | 'none' | BoardSwatch): string {
  switch (color) {
    case 'none':
      return translate('board.toolPanel.color.none', 'No fill')
    case 'text':
      return translate('board.toolPanel.color.text', 'Ink')
    case 'danger':
      return translate('board.toolPanel.color.red', 'Red')
    case 'accent':
      return translate('board.toolPanel.color.accent', 'Accent')
    case 'green':
      return translate('board.toolPanel.color.green', 'Green')
    case 'blue':
      return translate('board.toolPanel.color.blue', 'Blue')
    case 'purple':
      return translate('board.toolPanel.color.purple', 'Purple')
    case 'yellow':
      return translate('board.toolPanel.color.yellow', 'Yellow')
    case 'pink':
      return translate('board.toolPanel.color.pink', 'Pink')
  }
}

export function strokeWidthLabel(width: BoardStrokeWidth): string {
  switch (width) {
    case 'thin':
      return translate('board.toolPanel.width.thin', 'Thin')
    case 'medium':
      return translate('board.toolPanel.width.medium', 'Medium')
    case 'bold':
      return translate('board.toolPanel.width.bold', 'Bold')
  }
}

export function strokeStyleLabel(style: BoardStrokeStyle): string {
  switch (style) {
    case 'solid':
      return translate('board.toolPanel.style.solid', 'Solid')
    case 'dashed':
      return translate('board.toolPanel.style.dashed', 'Dashed')
    case 'dotted':
      return translate('board.toolPanel.style.dotted', 'Dotted')
  }
}

export function sloppinessLabel(sloppiness: BoardSloppiness): string {
  switch (sloppiness) {
    case 'architect':
      return translate('board.toolPanel.sloppiness.architect', 'Straight')
    case 'artist':
      return translate('board.toolPanel.sloppiness.artist', 'Hand-drawn')
    case 'cartoonist':
      return translate('board.toolPanel.sloppiness.cartoonist', 'Very loose')
  }
}

export function edgesLabel(edges: BoardEdges): string {
  return edges === 'sharp'
    ? translate('board.toolPanel.edges.sharp', 'Sharp corners')
    : translate('board.toolPanel.edges.round', 'Round corners')
}

export function textSizeLabel(size: BoardTextSize): string {
  switch (size) {
    case 'small':
      return translate('board.toolPanel.textSize.small', 'Small')
    case 'medium':
      return translate('board.toolPanel.textSize.medium', 'Medium')
    case 'large':
      return translate('board.toolPanel.textSize.large', 'Large')
    case 'xlarge':
      return translate('board.toolPanel.textSize.xlarge', 'Extra large')
  }
}

export function textAlignLabel(align: BoardTextAlign): string {
  switch (align) {
    case 'left':
      return translate('board.toolPanel.align.left', 'Align left')
    case 'center':
      return translate('board.toolPanel.align.center', 'Align center')
    case 'right':
      return translate('board.toolPanel.align.right', 'Align right')
  }
}

export function textFontLabel(font: BoardTextFont): string {
  switch (font) {
    case 'sans':
      return translate('board.toolPanel.font.sans', 'Clean')
    case 'rounded':
      return translate('board.toolPanel.font.rounded', 'Rounded')
    case 'serif':
      return translate('board.toolPanel.font.serif', 'Serif')
    case 'mono':
      return translate('board.toolPanel.font.mono', 'Typewriter')
    case 'hand':
      return translate('board.toolPanel.font.hand', 'Handwritten')
    case 'script':
      return translate('board.toolPanel.font.script', 'Script')
  }
}

export function fillStyleLabel(style: BoardFillStyle): string {
  switch (style) {
    case 'solid':
      return translate('board.toolPanel.fill.solid', 'Solid fill')
    case 'hachure':
      return translate('board.toolPanel.fill.hachure', 'Hatched fill')
    case 'cross-hatch':
      return translate('board.toolPanel.fill.crossHatch', 'Cross-hatched fill')
  }
}
