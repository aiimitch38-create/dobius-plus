import { useState } from 'react'
import { ImagePlus, MessageSquarePlus } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { StudioPanel, StudioAnnotation } from './studio-state'

export function StudioReview({
  panels,
  annotations,
  onAnnotations,
  onImport
}: {
  panels: StudioPanel[]
  annotations: StudioAnnotation[]
  onAnnotations: (annotations: StudioAnnotation[]) => void
  onImport: () => void
}): React.JSX.Element {
  const images = panels.filter((panel) => panel.kind === 'image' && panel.image)
  const [referenceId, setReferenceId] = useState(images[0]?.id ?? '')
  const [candidateId, setCandidateId] = useState(images[1]?.id ?? images[0]?.id ?? '')
  const [mode, setMode] = useState('Split')
  const [opacity, setOpacity] = useState(50)
  const [comment, setComment] = useState('')
  const [point, setPoint] = useState({ x: 50, y: 50 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const reference = images.find((image) => image.id === referenceId) ?? images[0]
  const candidate = images.find((image) => image.id === candidateId) ?? images[1] ?? images[0]
  const notes = annotations.filter((annotation) => annotation.imageId === candidate?.id)
  const imageSelect = (
    name: string,
    value: string,
    onChange: (id: string) => void
  ): React.JSX.Element => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={name}>
        <SelectValue placeholder={name} />
      </SelectTrigger>
      <SelectContent>
        {images.map((image) => (
          <SelectItem key={image.id} value={image.id}>
            {image.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  return (
    <div className="studio-review scrollbar-sleek">
      <div className="studio-review-heading">
        <div>
          <h1 className="text-2xl font-semibold">Design Review</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Compare references, mark changes, and track your review.
          </p>
        </div>
        <Button variant="outline" onClick={onImport}>
          <ImagePlus />
          Import image
        </Button>
      </div>
      {!images.length ? (
        <div className="studio-review-empty">
          <ImagePlus className="size-10" />
          <h2>Bring your work into focus</h2>
          <p>
            Import a reference and a result to compare them. Review notes are saved with the image.
          </p>
          <Button onClick={onImport}>Import your first image</Button>
        </div>
      ) : (
        <>
          <div className="studio-review-toolbar">
            {['Split', 'Overlay', 'Difference'].map((item) => (
              <Button
                size="sm"
                key={item}
                variant={mode === item ? 'secondary' : 'ghost'}
                aria-pressed={mode === item}
                onClick={() => setMode(item)}
              >
                {item}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">
              Visual comparison · no automated match score
            </span>
          </div>
          <div className="studio-review-images">
            <section>
              <div className="studio-section-title">Reference</div>
              {imageSelect('Reference image', reference?.id ?? '', setReferenceId)}
              {reference && (
                <img
                  className="studio-review-reference"
                  src={reference.image}
                  alt={`Reference: ${reference.title}`}
                />
              )}
            </section>
            <section>
              <div className="studio-section-title">
                {mode === 'Split'
                  ? 'Result · click to place a review pin'
                  : `${mode} · aligned to reference width`}
              </div>
              {imageSelect('Result image', candidate?.id ?? '', (id) => {
                setCandidateId(id)
                setSelectedId(null)
              })}
              {candidate && (
                <div
                  className="studio-review-image"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('button')) {
                      return
                    }
                    const bounds = event.currentTarget.getBoundingClientRect()
                    setPoint({
                      x: Math.max(
                        0,
                        Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)
                      ),
                      y: Math.max(
                        0,
                        Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)
                      )
                    })
                    setSelectedId(null)
                  }}
                >
                  <img
                    src={mode === 'Split' ? candidate.image : reference?.image}
                    alt={`Result: ${candidate.title}`}
                    style={
                      mode === 'Split'
                        ? {
                            filter: `brightness(${candidate.brightness}%) contrast(${candidate.contrast}%)`
                          }
                        : undefined
                    }
                  />
                  {mode !== 'Split' && (
                    <img
                      className="studio-review-overlay"
                      src={candidate.image}
                      alt="Comparison overlay"
                      style={{
                        opacity: mode === 'Overlay' ? opacity / 100 : 1,
                        mixBlendMode: mode === 'Difference' ? 'difference' : 'normal',
                        filter: `brightness(${candidate.brightness}%) contrast(${candidate.contrast}%)`
                      }}
                    />
                  )}
                  {notes.map((note, index) => (
                    <button
                      key={note.id}
                      className="studio-review-pin"
                      aria-label={`Review pin ${index + 1}: ${note.text}`}
                      style={{ left: `${note.x}%`, top: `${note.y}%` }}
                      data-resolved={note.status === 'Resolved'}
                      onClick={() => setSelectedId(note.id)}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <span
                    className="studio-review-crosshair"
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  >
                    <MessageSquarePlus className="size-5" />
                  </span>
                </div>
              )}
            </section>
          </div>
          {mode === 'Overlay' && (
            <label className="mt-4 flex items-center gap-4 text-sm">
              Overlay opacity
              <input
                aria-label="Overlay opacity"
                type="range"
                min="0"
                max="100"
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
              />
              {opacity}%
            </label>
          )}
          <section className="studio-review-notes">
            <h2 className="mb-4 font-medium">Review notes · {notes.length}</h2>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!comment.trim() || !candidate) {
                  return
                }
                onAnnotations([
                  ...annotations,
                  {
                    id: crypto.randomUUID(),
                    imageId: candidate.id,
                    text: comment.trim(),
                    ...point,
                    status: 'Open'
                  }
                ])
                setComment('')
              }}
            >
              <Input
                aria-label="Review comment"
                placeholder="Describe the change at this pin…"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <Button type="submit" disabled={!comment.trim()}>
                Add annotation
              </Button>
            </form>
            {notes.map((note, index) => (
              <div
                className="studio-review-note"
                key={note.id}
                data-selected={selectedId === note.id}
              >
                <span>{index + 1}</span>
                <Input
                  aria-label={`Annotation ${index + 1}`}
                  value={note.text}
                  onChange={(event) =>
                    onAnnotations(
                      annotations.map((item) =>
                        item.id === note.id ? { ...item, text: event.target.value } : item
                      )
                    )
                  }
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onAnnotations(
                      annotations.map((item) =>
                        item.id === note.id
                          ? { ...item, status: item.status === 'Open' ? 'Resolved' : 'Open' }
                          : item
                      )
                    )
                  }
                >
                  {note.status}
                </Button>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  )
}
