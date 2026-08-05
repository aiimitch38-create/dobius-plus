import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import type { CustomAgent } from '../../../../../shared/agents'
import { isContinuation, type ThreadMessage } from './messages'
import { notifyTyping } from './typing'
import type { RelayProfile } from './profile'

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDayHeading(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(date, today)) {return 'Today'}
  if (sameDay(date, yesterday)) {return 'Yesterday'}
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

function MessageRow({
  message,
  continuation,
  displayName
}: {
  message: ThreadMessage
  continuation: boolean
  displayName: string
}): React.JSX.Element {
  const initial = displayName.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="group flex gap-2.5 rounded-2xl px-2 py-1 hover:bg-[var(--muted)]/50">
      <div className="flex w-9 shrink-0 items-start justify-center pt-0.5">
        {continuation ? (
          <span
            className="text-2xs opacity-0 transition-opacity group-hover:opacity-100"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {formatTime(message.createdAt)}
          </span>
        ) : (
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold shadow-xs"
            style={{ background: 'var(--secondary)', color: 'var(--secondary-foreground)' }}
          >
            {initial}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!continuation && (
          <div className="flex flex-wrap items-baseline gap-x-1.5 leading-4">
            <span className="text-sm leading-4 font-semibold tracking-tight">{displayName}</span>
            <span className="text-xs leading-4 font-normal tabular-nums" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
              {formatTime(message.createdAt)}
            </span>
          </div>
        )}
        <div className="max-w-full text-sm whitespace-pre-wrap">
          {message.content}
          {message.edited && (
            <span className="ml-1 text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
              (edited)
            </span>
          )}
        </div>
        {message.pending && (
          <span className="text-xs font-normal" style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
            Sending…
          </span>
        )}
      </div>
    </div>
  )
}

export function BuzzConversationThread({
  channelId,
  displayName,
  otherProfile,
  messages,
  loading,
  workingAgent,
  onSend
}: {
  channelId: string | null
  displayName: string
  otherProfile: RelayProfile | null
  messages: ThreadMessage[]
  loading: boolean
  workingAgent: CustomAgent | null
  onSend: (content: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, channelId])

  useEffect(() => {
    setDraft('')
  }, [channelId])

  const grouped = useMemo(() => {
    return messages.map((message, index) => ({
      message,
      continuation: isContinuation(messages[index - 1], message)
    }))
  }, [messages])

  const dayGroups = useMemo(() => {
    const groups: { heading: string; rows: typeof grouped }[] = []
    for (const row of grouped) {
      const heading = formatDayHeading(row.message.createdAt)
      const last = groups.at(-1)
      if (last && last.heading === heading) {
        last.rows.push(row)
      } else {
        groups.push({ heading, rows: [row] })
      }
    }
    return groups
  }, [grouped])

  if (!channelId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Select a direct message to start reading.
      </div>
    )
  }

  const submit = (): void => {
    const trimmed = draft.trim()
    if (!trimmed) {return}
    onSend(trimmed)
    setDraft('')
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex gap-2.5">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center pt-10 text-center">
            <span
              className="flex h-[60px] w-[60px] items-center justify-center rounded-full text-lg"
              style={{ background: 'var(--secondary)', color: 'var(--secondary-foreground)' }}
            >
              {displayName.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <div className="mt-4 text-xl leading-7 font-semibold tracking-tight">{displayName}</div>
            <div className="mt-1 text-sm leading-5" style={{ color: 'var(--muted-foreground)' }}>
              This is the beginning of your direct message with{' '}
              <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                {displayName}
              </span>
              .
            </div>
          </div>
        ) : (
          dayGroups.map((group) => (
            <div key={group.heading}>
              <div className="sticky top-0 z-10 flex justify-center py-2">
                <span
                  className="rounded-full border px-2.5 py-1 text-2xs font-medium tracking-[0.02em]"
                  style={{ borderColor: 'var(--border)', background: 'var(--background)', color: 'var(--muted-foreground)', opacity: 0.9 }}
                >
                  {group.heading}
                </span>
              </div>
              {group.rows.map(({ message, continuation }) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  continuation={continuation}
                  displayName={message.pubkey === otherProfile?.pubkey ? displayName : 'You'}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {workingAgent && (
        <div className="flex items-center gap-2 px-4 pb-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {workingAgent.name} is working
        </div>
      )}

      <div className="px-4 pb-4">
        <div
          className="flex items-end gap-2 rounded-2xl border px-3 pt-3 pb-2"
          style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
        >
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              notifyTyping(channelId)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            placeholder={`Message ${displayName}`}
            rows={1}
            className="max-h-32 min-h-0 flex-1 resize-none border-0 bg-transparent py-0 text-sm leading-5 outline-none"
            style={{ color: 'var(--foreground)' }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
