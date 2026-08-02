import React from 'react'
import {
  AtSign,
  ArrowUp,
  CaseSensitive,
  Hash,
  Headphones,
  Inbox,
  Lock,
  Paperclip,
  Search,
  Settings2,
  Smile,
  Users
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  BUZZ_DMS,
  BUZZ_LOCKED_CHANNELS,
  BUZZ_MESSAGES,
  BUZZ_SECTIONS,
  type BuzzChannel,
  type BuzzMessage
} from './buzz-demo-data'

// The Buzz tab: a faithful recreation of Block's Buzz workspace UI
// (github.com/block/buzz, Apache 2.0) — gradient canvas, transparent channel
// sidebar, floating white content card. Palette lives in buzz-skin.css under
// `.buzz-page`; demo thread content in buzz-demo-data.ts.

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
}

function Avatar({ name, tone, size }: { name: string; tone: string; size: 'sm' | 'md' }): React.JSX.Element {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-black/60',
        tone,
        size === 'md' ? 'size-8 text-xs' : 'size-5 text-[9px]'
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

function AgentChip({ name }: { name: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[var(--buzz-chip-surface)] px-1.5 py-px text-[13px] font-medium">
      <span aria-hidden>🤖</span>
      {name}
    </span>
  )
}

function BodyLine({ parts }: { parts: string[] }): React.JSX.Element {
  return (
    <p className="text-sm leading-relaxed">
      {parts.map((part, i) =>
        part.startsWith('mention:') ? (
          <React.Fragment key={i}>
            <AgentChip name={part.slice('mention:'.length)} />{' '}
          </React.Fragment>
        ) : (
          <React.Fragment key={i}>{part} </React.Fragment>
        )
      )}
    </p>
  )
}

function ChannelRow({ channel }: { channel: BuzzChannel }): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors',
        channel.active
          ? 'bg-[var(--buzz-active-surface)] font-medium'
          : 'hover:bg-[var(--buzz-hover-surface)]'
      )}
    >
      {channel.locked ? (
        <Lock className="size-3.5 shrink-0 text-[var(--buzz-muted-foreground)]" />
      ) : (
        <Hash className="size-3.5 shrink-0 text-[var(--buzz-muted-foreground)]" />
      )}
      <span className={cn('flex-1 truncate', channel.unread && 'font-semibold')}>
        {channel.name}
      </span>
      {channel.badge ? (
        <span className="rounded-full bg-[var(--buzz-chip-surface)] px-1.5 text-[11px] text-[var(--buzz-muted-foreground)]">
          {channel.badge}
        </span>
      ) : channel.unread ? (
        <span className="size-1.5 rounded-full bg-current" />
      ) : null}
    </button>
  )
}

function Message({ message }: { message: BuzzMessage }): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <Avatar name={message.author} tone={message.tone} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{message.author}</span>
          <span className="text-[11px] text-[var(--buzz-muted-foreground)]">{message.time}</span>
        </div>
        <BodyLine parts={message.body} />
        {message.list ? (
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            {message.list.map((entry) => (
              <li key={entry.title}>
                <span className="font-semibold">{entry.title}</span>
                <ul className="list-disc pl-5">
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : null}
        {message.footer ? (
          <div className="mt-2">
            <BodyLine parts={message.footer} />
          </div>
        ) : null}
        {message.reactions ? (
          <div className="mt-1.5 flex gap-1">
            {message.reactions.map((reaction) => (
              <span
                key={reaction.emoji}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--buzz-hairline)] px-2 py-px text-xs"
              >
                {reaction.emoji} {reaction.count}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SidebarLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-2 pt-4 pb-1 text-[11px] font-medium text-[var(--buzz-muted-foreground)]">
      {children}
    </div>
  )
}

export default function BuzzPage(): React.JSX.Element {
  return (
    <div className="buzz-page flex min-h-0 flex-1 text-[var(--buzz-card-foreground)]">
      {/* Channel sidebar — transparent over the gradient */}
      <aside className="flex w-60 shrink-0 flex-col overflow-y-auto px-2 py-3">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-[var(--buzz-hover-surface)] px-2.5 py-1.5 text-sm text-[var(--buzz-muted-foreground)]"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search everything</span>
          <span className="text-[11px]">⌘K</span>
        </button>
        <div className="mt-3 space-y-px">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-[var(--buzz-hover-surface)]"
          >
            <Inbox className="size-4 text-[var(--buzz-soft-foreground)]" /> Inbox
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-[var(--buzz-hover-surface)]"
          >
            <span aria-hidden className="w-4 text-center">
              🤖
            </span>
            Agents
          </button>
        </div>
        {BUZZ_SECTIONS.map((section) => (
          <React.Fragment key={section.label}>
            <SidebarLabel>
              {section.emoji ? <span aria-hidden>{section.emoji} </span> : null}
              {section.label}
            </SidebarLabel>
            <div className="space-y-px">
              {section.channels.map((channel) => (
                <ChannelRow key={channel.name} channel={channel} />
              ))}
            </div>
          </React.Fragment>
        ))}
        <SidebarLabel>Channels</SidebarLabel>
        <div className="space-y-px">
          {BUZZ_LOCKED_CHANNELS.map((channel) => (
            <ChannelRow key={channel.name} channel={channel} />
          ))}
        </div>
        <SidebarLabel>Direct messages</SidebarLabel>
        <div className="space-y-px">
          {BUZZ_DMS.map((dm) => (
            <button
              key={dm.name}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-[var(--buzz-hover-surface)]"
            >
              <Avatar name={dm.name} tone={dm.tone} size="sm" />
              <span className="flex-1 truncate font-semibold">{dm.name}</span>
              <span className="flex size-4 items-center justify-center rounded-full bg-current text-[10px]">
                <span className="text-[var(--buzz-card)]">{dm.unread}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2 rounded-md px-2 pt-4 pb-1">
          <Avatar name="Alex Rivera" tone="bg-emerald-300" size="md" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Alex Rivera</div>
            <div className="truncate text-[11px] text-[var(--buzz-muted-foreground)]">
              🐝 Honeycomb Studios
            </div>
          </div>
        </div>
      </aside>

      {/* Floating content card */}
      <main className="buzz-content-card mx-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-[var(--buzz-hairline)] px-4 py-2.5">
          <Hash className="size-4 text-[var(--buzz-muted-foreground)]" />
          <span className="text-sm font-semibold">flight-path</span>
          <div className="ml-auto flex items-center gap-1 text-[var(--buzz-soft-foreground)]">
            <span className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-[var(--buzz-hover-surface)]">
              <Users className="size-3.5" /> 9
            </span>
            <span className="rounded-md p-1.5 hover:bg-[var(--buzz-hover-surface)]">
              <Headphones className="size-3.5" />
            </span>
            <span className="rounded-md p-1.5 hover:bg-[var(--buzz-hover-surface)]">
              <Settings2 className="size-3.5" />
            </span>
          </div>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--buzz-hairline)]" />
            <span className="text-[11px] font-semibold tracking-wide text-[var(--buzz-muted-foreground)]">
              NEW
            </span>
            <div className="h-px flex-1 bg-[var(--buzz-hairline)]" />
          </div>
          {BUZZ_MESSAGES.map((message, index) => (
            <Message key={index} message={message} />
          ))}
        </div>
        <footer className="px-4 pb-3">
          <div className="rounded-lg border border-[var(--buzz-hairline)] px-3 py-2">
            <div className="text-sm text-[var(--buzz-muted-foreground)]">Message #flight-path</div>
            <div className="mt-2 flex items-center gap-2 text-[var(--buzz-soft-foreground)]">
              <AtSign className="size-4" />
              <Paperclip className="size-4" />
              <Smile className="size-4" />
              <CaseSensitive className="size-4" />
              <span className="ml-auto flex size-7 items-center justify-center rounded-full bg-[var(--buzz-chip-surface)]">
                <ArrowUp className="size-4" />
              </span>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--buzz-muted-foreground)]">
            <span aria-hidden>🐞</span> Honey: Working
          </div>
        </footer>
      </main>
    </div>
  )
}
