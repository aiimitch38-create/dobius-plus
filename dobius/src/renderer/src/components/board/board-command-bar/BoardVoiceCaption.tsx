import React, { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { boardVoiceCaptionPhase, boardVoiceCaptionText } from './board-voice-caption'

// Why: offline speech models only produce text once the mic closes, so the
// final words would otherwise vanish as the command submits. Keep them briefly.
const LINGER_MS = 2_500

/**
 * Live caption under the command bar while dictation runs: "• listening" plus
 * the words heard so far (streaming models' partial transcript, and finished
 * segments already typed into the draft).
 */
export function BoardVoiceCaption({ draft }: { draft: string }): React.JSX.Element | null {
  const phase = useAppStore((s) => boardVoiceCaptionPhase(s.dictationState))
  const partial = useAppStore((s) => s.partialTranscript)
  // Derived-from-props state (set during render), so no refs are read in render.
  const [session, setSession] = useState<{ draftAtStart: string; heard: string } | null>(null)
  const [linger, setLinger] = useState<string | null>(null)

  if (phase && !session) {
    setSession({ draftAtStart: draft, heard: '' })
    setLinger(null)
  } else if (!phase && session) {
    setSession(null)
    setLinger(session.heard || null)
  }
  const text = phase && session ? boardVoiceCaptionText(session.draftAtStart, draft, partial) : ''
  if (session && text && text !== session.heard) {
    setSession({ ...session, heard: text })
  }

  useEffect(() => {
    if (!linger) {
      return
    }
    const timer = window.setTimeout(() => setLinger(null), LINGER_MS)
    return () => window.clearTimeout(timer)
  }, [linger])

  const shown = phase ? text : linger
  if (!phase && !shown) {
    return null
  }
  const status =
    phase === 'processing'
      ? translate('board.voice.processing', 'processing')
      : phase === 'listening'
        ? translate('board.voice.listening', 'listening')
        : null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute top-[calc(100%-6px)] left-1/2 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-baseline gap-2 rounded-[12px] bg-[var(--board-panel)] px-3 py-1.5 text-[13px] leading-snug text-[var(--board-text)] shadow-(--board-shadow)"
    >
      {status ? (
        <span className="flex shrink-0 items-center gap-1.5 font-medium text-[var(--board-danger-text)]">
          <span className="size-1.5 animate-pulse rounded-full bg-[var(--board-danger-text)]" />
          {status}
        </span>
      ) : null}
      {shown ? (
        <span className="line-clamp-2 min-w-0">{shown}</span>
      ) : (
        <span className="text-[var(--board-text-muted)]">…</span>
      )}
    </div>
  )
}
