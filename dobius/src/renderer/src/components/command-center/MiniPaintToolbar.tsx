import {
  Eraser,
  Hand,
  MousePointer2,
  Paintbrush,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { Button } from '../ui/button'
import { Label } from '../ui/label'

type PaintTool = 'select' | 'brush' | 'eraser' | 'hand'

export function MiniPaintToolbar({
  tool,
  setTool,
  color,
  setColor,
  brushSize,
  setBrushSize,
  canUndo,
  canRedo,
  undo,
  redo,
  zoom,
  setZoom
}: {
  tool: PaintTool
  setTool: (tool: PaintTool) => void
  color: string
  setColor: (color: string) => void
  brushSize: number
  setBrushSize: (size: number) => void
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  zoom: number
  setZoom: (change: (value: number) => number) => void
}): React.JSX.Element {
  return (
    <div className="studio-paint-toolbar" role="toolbar" aria-label="Paint tools">
      {(
        [
          ['select', MousePointer2, 'Select'],
          ['brush', Paintbrush, 'Brush'],
          ['eraser', Eraser, 'Eraser'],
          ['hand', Hand, 'Pan canvas']
        ] as const
      ).map(([value, Icon, label]) => (
        <Button
          key={value}
          size="icon-sm"
          variant={tool === value ? 'secondary' : 'ghost'}
          aria-label={label}
          aria-pressed={tool === value}
          onClick={() => setTool(value)}
        >
          <Icon />
        </Button>
      ))}
      <span className="studio-paint-divider" />
      <Label htmlFor="paint-color">Color</Label>
      <input
        id="paint-color"
        className="studio-paint-color"
        type="color"
        value={color}
        onChange={(event) => setColor(event.target.value)}
      />
      <Label htmlFor="paint-size">Size</Label>
      <input
        id="paint-size"
        className="studio-paint-size"
        type="range"
        min="2"
        max="160"
        value={brushSize}
        onChange={(event) => setBrushSize(Number(event.target.value))}
      />
      <span className="studio-paint-value">{brushSize}px</span>
      <span className="studio-paint-divider" />
      <Button size="icon-sm" variant="ghost" aria-label="Undo" onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Redo" onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </Button>
      <span className="studio-paint-divider" />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Zoom out"
        onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
      >
        <ZoomOut />
      </Button>
      <span className="studio-paint-value">{Math.round(zoom * 100)}%</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Zoom in"
        onClick={() => setZoom((value) => Math.min(2, value + 0.1))}
      >
        <ZoomIn />
      </Button>
    </div>
  )
}

export type { PaintTool }
