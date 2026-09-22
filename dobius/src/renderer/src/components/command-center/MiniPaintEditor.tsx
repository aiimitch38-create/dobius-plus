import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Upload } from 'lucide-react'
import { Button } from '../ui/button'
import type { StudioPanel } from './studio-state'
import { MiniPaintLayers } from './MiniPaintLayers'
import { MiniPaintToolbar, type PaintTool } from './MiniPaintToolbar'

type Tool = PaintTool
type LayerStore = {
  id: string
  name: string
  visible: boolean
  opacity: number
  canvas: HTMLCanvasElement
}
type HistoryEntry = { layerId: string; image: ImageData }

const DEFAULT_SIZE = { width: 1200, height: 780 }

function newLayer(name: string, width: number, height: number): LayerStore {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return { id: crypto.randomUUID(), name, visible: true, opacity: 1, canvas }
}

export function MiniPaintEditor({
  image,
  onBack
}: {
  image?: StudioPanel
  onBack: () => void
}): React.JSX.Element {
  const displayCanvas = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const layersRef = useRef<LayerStore[]>([])
  const historyRef = useRef<HistoryEntry[]>([])
  const redoRef = useRef<HistoryEntry[]>([])
  const drawingRef = useRef(false)
  const [layers, setLayers] = useState<LayerStore[]>([])
  const [activeLayerId, setActiveLayerId] = useState('')
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#70b7ff')
  const [brushSize, setBrushSize] = useState(24)
  const [zoom, setZoom] = useState(1)
  const [status, setStatus] = useState('Ready')

  const syncLayers = (): void => {
    setLayers(layersRef.current.map(({ canvas: _canvas, ...layer }) => layer as LayerStore))
  }
  const renderComposite = (): void => {
    const target = displayCanvas.current
    if (!target || !layersRef.current.length) {
      return
    }
    const context = target.getContext('2d')
    if (!context) {
      return
    }
    context.clearRect(0, 0, target.width, target.height)
    for (const layer of layersRef.current) {
      if (!layer.visible) {
        continue
      }
      context.globalAlpha = layer.opacity
      context.drawImage(layer.canvas, 0, 0)
    }
    context.globalAlpha = 1
  }

  useEffect(() => {
    const width = image?.image ? image.width * 3 : DEFAULT_SIZE.width
    const height = image?.image ? image.height * 3 : DEFAULT_SIZE.height
    const base = newLayer('Background', width, height)
    const paint = newLayer('Paint layer', width, height)
    if (image?.image) {
      const source = new Image()
      source.onload = () => {
        const context = base.canvas.getContext('2d')
        if (!context) {
          return
        }
        context.fillStyle = '#f4f7fb'
        context.fillRect(0, 0, width, height)
        context.drawImage(source, 0, 0, width, height)
        renderComposite()
        setStatus('Reference loaded')
      }
      source.src = image.image
    } else {
      const context = base.canvas.getContext('2d')
      if (context) {
        context.fillStyle = '#f4f7fb'
        context.fillRect(0, 0, width, height)
      }
    }
    layersRef.current = [paint, base]
    historyRef.current = []
    redoRef.current = []
    setActiveLayerId(paint.id)
    setLayers([paint, base])
    const target = displayCanvas.current
    if (target) {
      target.width = width
      target.height = height
    }
    requestAnimationFrame(renderComposite)
  }, [image?.image, image?.height, image?.width])

  const activeLayer = (): LayerStore | undefined =>
    layersRef.current.find((layer) => layer.id === activeLayerId)
  const point = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = displayCanvas.current
    if (!canvas) {
      return { x: 0, y: 0 }
    }
    const bounds = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height
    }
  }
  const draw = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const layer = activeLayer()
    if (!drawingRef.current || !layer || tool === 'hand' || tool === 'select') {
      return
    }
    const context = layer.canvas.getContext('2d')
    if (!context) {
      return
    }
    const { x, y } = point(event)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = brushSize
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    context.strokeStyle = color
    context.lineTo(x, y)
    context.stroke()
    renderComposite()
  }
  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (tool === 'hand' || tool === 'select') {
      return
    }
    const layer = activeLayer()
    const context = layer?.canvas.getContext('2d')
    if (!layer || !context) {
      return
    }
    historyRef.current.push({
      layerId: layer.id,
      image: context.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    })
    redoRef.current = []
    const { x, y } = point(event)
    context.beginPath()
    context.moveTo(x, y)
    drawingRef.current = true
    displayCanvas.current?.setPointerCapture(event.pointerId)
    draw(event)
  }
  const finishDrawing = (): void => {
    if (!drawingRef.current) {
      return
    }
    drawingRef.current = false
    activeLayer()?.canvas.getContext('2d')?.closePath()
    setStatus(tool === 'eraser' ? 'Erased pixels' : 'Painted on active layer')
  }
  const undo = (): void => {
    const previous = historyRef.current.pop()
    if (!previous) {
      return
    }
    const layer = layersRef.current.find((item) => item.id === previous.layerId)
    const context = layer?.canvas.getContext('2d')
    if (!layer || !context) {
      return
    }
    redoRef.current.push({
      layerId: layer.id,
      image: context.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    })
    context.putImageData(previous.image, 0, 0)
    renderComposite()
    setStatus('Undid last stroke')
  }
  const redo = (): void => {
    const next = redoRef.current.pop()
    if (!next) {
      return
    }
    const layer = layersRef.current.find((item) => item.id === next.layerId)
    const context = layer?.canvas.getContext('2d')
    if (!layer || !context) {
      return
    }
    historyRef.current.push({
      layerId: layer.id,
      image: context.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    })
    context.putImageData(next.image, 0, 0)
    renderComposite()
    setStatus('Redid last stroke')
  }
  const addLayer = (): void => {
    const source = layersRef.current[0]
    if (!source) {
      return
    }
    const layer = newLayer(
      `Layer ${layersRef.current.length}`,
      source.canvas.width,
      source.canvas.height
    )
    layersRef.current.unshift(layer)
    setActiveLayerId(layer.id)
    syncLayers()
    setStatus('New layer added')
  }
  const removeLayer = (): void => {
    if (layersRef.current.length <= 1) {
      return
    }
    layersRef.current = layersRef.current.filter((layer) => layer.id !== activeLayerId)
    setActiveLayerId(layersRef.current[0]?.id ?? '')
    syncLayers()
    renderComposite()
    setStatus('Layer removed')
  }
  const toggleLayerVisibility = (id: string): void => {
    const layer = layersRef.current.find((item) => item.id === id)
    if (!layer) {
      return
    }
    layer.visible = !layer.visible
    syncLayers()
    renderComposite()
  }
  const changeLayerOpacity = (opacity: number): void => {
    const layer = activeLayer()
    if (!layer) {
      return
    }
    layer.opacity = opacity
    syncLayers()
    renderComposite()
  }
  const exportImage = (): void => {
    const canvas = displayCanvas.current
    if (!canvas) {
      return
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        return
      }
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(blob)
      anchor.download = `${image?.title?.replace(/[^a-z0-9-_]/gi, '-') ?? 'vertex-edit'}.png`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(anchor.href), 1000)
      setStatus('PNG exported')
    })
  }
  const importImage = (file?: File): void => {
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const source = new Image()
      source.onload = () => {
        const layer = activeLayer()
        const context = layer?.canvas.getContext('2d')
        if (!layer || !context) {
          return
        }
        context.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
        context.drawImage(source, 0, 0, layer.canvas.width, layer.canvas.height)
        renderComposite()
        setStatus('Image imported to active layer')
      }
      source.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  return (
    <section className="studio-editor studio-paint-editor" aria-label="Vertex image editor">
      <header className="studio-editor-header">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          Back to Canvas
        </Button>
        <div className="studio-editor-title">
          <h1>Vertex Paint</h1>
          <span>Local image editor · {image?.title ?? 'New artwork'}</span>
        </div>
        <div className="studio-editor-actions">
          <span className="studio-editor-status">{status}</span>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload />
            Import
          </Button>
          <Button size="sm" onClick={exportImage}>
            <Download />
            Export PNG
          </Button>
        </div>
      </header>
      <MiniPaintToolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        canUndo={Boolean(historyRef.current.length)}
        canRedo={Boolean(redoRef.current.length)}
        undo={undo}
        redo={redo}
        zoom={zoom}
        setZoom={setZoom}
      />
      <div className="studio-paint-layout">
        <div className="studio-paint-stage">
          <div className="studio-paint-canvas-wrap" style={{ transform: `scale(${zoom})` }}>
            <canvas
              ref={displayCanvas}
              className="studio-paint-canvas"
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={finishDrawing}
              onPointerCancel={finishDrawing}
              onPointerLeave={finishDrawing}
              aria-label="Editable image canvas"
            />
          </div>
        </div>
        <MiniPaintLayers
          layers={layers}
          activeLayerId={activeLayerId}
          onSelect={setActiveLayerId}
          onToggleVisibility={toggleLayerVisibility}
          onOpacityChange={changeLayerOpacity}
          onAdd={addLayer}
          onRemove={removeLayer}
        />
        <input
          ref={fileInput}
          className="hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            importImage(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
    </section>
  )
}
