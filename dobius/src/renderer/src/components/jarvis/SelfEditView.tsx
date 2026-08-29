import { useEffect, useMemo, useRef, useState } from 'react'
import { applyDocumentTheme } from '@/lib/document-theme'
import { Button } from '../ui/button'
import { collapseContext, diffLines, type DiffLine } from './diff-lines'

/** Lines revealed per tick while "typing" the change in. */
const REVEAL_PER_TICK = 2
const REVEAL_INTERVAL_MS = 45

type Proposal = {
  id: string
  displayPath: string
  description: string
  oldContent: string
  newContent: string
}

function isProposal(value: unknown): value is Proposal {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<Proposal>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.displayPath === 'string' &&
    typeof candidate.oldContent === 'string' &&
    typeof candidate.newContent === 'string'
  )
}

function lineClass(kind: DiffLine['kind']): string {
  if (kind === 'added') {
    return 'bg-primary/10 text-foreground'
  }
  if (kind === 'removed') {
    return 'bg-destructive/10 text-muted-foreground line-through'
  }
  return 'text-muted-foreground'
}

function linePrefix(kind: DiffLine['kind']): string {
  return kind === 'added' ? '+' : kind === 'removed' ? '-' : ' '
}

/**
 * Review surface for a change Adam wants to make to his own code.
 *
 * Why the reveal animation: the point of this window is that the user watches
 * the edit arrive and reads it, rather than being handed a finished diff to
 * rubber-stamp. Nothing is written until Approve.
 */
export function SelfEditView(): React.JSX.Element {
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [revealed, setRevealed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Match the user's chosen skin; the bootstrap in main.tsx only sets 'system'.
  useEffect(() => {
    void window.api.settings
      .get()
      .then((settings) => applyDocumentTheme(settings.theme ?? 'system', { disableTransitions: true }))
      .catch(() => undefined)
  }, [])

  useEffect(
    () =>
      window.api.jarvis.onSelfEditProposal((incoming) => {
        if (!isProposal(incoming)) {
          return
        }
        setMessage(null)
        setRevealed(0)
        setProposal(incoming)
      }),
    []
  )

  const lines = useMemo(
    () => (proposal ? collapseContext(diffLines(proposal.oldContent, proposal.newContent)) : []),
    [proposal]
  )

  useEffect(() => {
    if (!proposal || revealed >= lines.length) {
      return
    }
    const timer = window.setTimeout(
      () => setRevealed((current) => Math.min(current + REVEAL_PER_TICK, lines.length)),
      REVEAL_INTERVAL_MS
    )
    return () => window.clearTimeout(timer)
  }, [lines.length, proposal, revealed])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [revealed])

  const approve = async (): Promise<void> => {
    if (!proposal) {
      return
    }
    setBusy(true)
    const result = await window.api.jarvis.applySelfEdit(proposal.id)
    setBusy(false)
    if (result.ok) {
      setMessage(`Applied to ${result.displayPath}.`)
      setProposal(null)
      return
    }
    setMessage(result.error)
  }

  const discard = async (): Promise<void> => {
    if (!proposal) {
      return
    }
    setBusy(true)
    await window.api.jarvis.discardSelfEdit(proposal.id)
    setBusy(false)
    setProposal(null)
    setMessage('Discarded. Nothing was written.')
  }

  if (!proposal) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">{message ?? 'No change waiting for review.'}</p>
      </div>
    )
  }

  const stillTyping = revealed < lines.length
  const added = lines.filter((line) => line.kind === 'added').length
  const removed = lines.filter((line) => line.kind === 'removed').length

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-10">
        <p className="font-mono text-sm">{proposal.displayPath}</p>
        <p className="mt-1 text-xs text-muted-foreground">{proposal.description}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          +{added} / -{removed}
          {stillTyping ? ' · writing…' : ' · ready for review'}
        </p>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <pre className="font-mono text-xs leading-relaxed">
          {lines.slice(0, revealed).map((line, index) => (
            <div key={`${index}-${line.text}`} className={`px-2 ${lineClass(line.kind)}`}>
              {linePrefix(line.kind)} {line.text || ' '}
            </div>
          ))}
          {stillTyping ? <span className="ml-2 animate-pulse">▌</span> : null}
        </pre>
      </div>

      <footer className="shrink-0 border-t border-border px-4 py-3">
        <p className="mb-2 text-xs text-muted-foreground">
          Say “approve” to apply, or use the buttons. Nothing is written until you do.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void approve()} disabled={busy || stillTyping}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => void discard()} disabled={busy}>
            Discard
          </Button>
          {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
        </div>
      </footer>
    </div>
  )
}
