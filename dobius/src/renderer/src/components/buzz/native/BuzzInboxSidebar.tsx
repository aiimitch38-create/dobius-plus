import { CircleDot, SquarePen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DmChannelWithLabel } from './channels'

export function BuzzInboxSidebar({
  channels,
  selectedChannelId,
  onSelectChannel,
  onNewMessage,
  loading
}: {
  channels: DmChannelWithLabel[]
  selectedChannelId: string | null
  onSelectChannel: (channelId: string) => void
  onNewMessage: () => void
  loading: boolean
}): React.JSX.Element {
  return (
    <div
      className="flex w-64 shrink-0 flex-col border-r"
      style={{ background: 'var(--sidebar)', borderColor: 'var(--sidebar-border)' }}
    >
      <div className="flex items-center justify-between px-3 pt-4 pb-2">
        <span
          className="text-xs font-medium tracking-wide uppercase"
          style={{ color: 'var(--sidebar-foreground)', opacity: 0.6 }}
        >
          Direct messages
        </span>
        {/* Why: loadDmChannels only returns channels already on the relay, so an
            empty inbox is otherwise a dead end with no way to start a conversation. */}
        <button
          type="button"
          onClick={onNewMessage}
          aria-label="New message"
          title="New message"
          className="rounded-md p-1 transition-colors hover:bg-[var(--sidebar-accent)]"
          style={{ color: 'var(--sidebar-foreground)' }}
        >
          <SquarePen className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col gap-1 px-2 py-1">
            {[0, 1].map((index) => (
              <div key={index} className="flex items-center gap-2 rounded-md p-2">
                <div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="px-2 py-4 text-sm" style={{ color: 'var(--sidebar-foreground)', opacity: 0.5 }}>
            No direct messages yet.
            <button
              type="button"
              onClick={onNewMessage}
              className="mt-2 block underline underline-offset-2 hover:opacity-80"
            >
              Message an agent
            </button>
          </div>
        ) : (
          channels.map((channel) => {
            const isActive = channel.id === selectedChannelId
            const initial = channel.label.trim().charAt(0).toUpperCase() || '?'
            return (
              <button
                key={channel.id}
                type="button"
                onClick={() => onSelectChannel(channel.id)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors',
                  isActive ? 'shadow-xs' : 'hover:bg-[var(--sidebar-accent)]'
                )}
                style={
                  isActive
                    ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
                    : { color: 'var(--sidebar-foreground)' }
                }
              >
                {channel.otherProfile?.avatarUrl ? (
                  <img
                    src={channel.otherProfile.avatarUrl}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                ) : channel.otherPubkeys.length <= 1 ? (
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold"
                    style={{ background: 'var(--secondary)', color: 'var(--secondary-foreground)' }}
                  >
                    {channel.otherPubkeys.length === 0 ? <CircleDot className="h-3.5 w-3.5" /> : initial}
                  </span>
                ) : (
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold"
                    style={{ background: 'var(--sidebar-accent)', color: 'var(--sidebar-accent-foreground)' }}
                  >
                    {channel.otherPubkeys.length}
                  </span>
                )}
                <span className="truncate">{channel.label}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
