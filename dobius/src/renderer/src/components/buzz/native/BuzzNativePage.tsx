import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomAgent } from '../../../../../shared/agents'
import { BuzzInboxSidebar } from './BuzzInboxSidebar'
import { BuzzConversationThread } from './BuzzConversationThread'
import { loadDmChannels, openDmWithPeer, withResolvedLabels, type DmChannelWithLabel } from './channels'
import { loadChannelMessages, sendDmMessage, type ThreadMessage } from './messages'
import { dispatchIfAgentDm, isAgentWorking, loadAgentDirectory, type AgentDirectory } from './agent-dispatch'
import './buzz-native-theme.css'

// ponytail: no live relay subscription exists yet for this native tab, so new
// messages/agent replies are picked up by a short poll while a thread is open
// rather than pushed in real time. Swap for a WS subscription if/when one
// exists for other reasons — the polling interval is the only thing to change.
const MESSAGE_POLL_MS = 2_000
const AGENT_STATUS_POLL_MS = 1_500

export function BuzzNativePage(): React.JSX.Element {
  const [channels, setChannels] = useState<DmChannelWithLabel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [workingAgent, setWorkingAgent] = useState<CustomAgent | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerBusy, setPickerBusy] = useState<string | null>(null)
  const directoryRef = useRef<AgentDirectory>({ byPubkey: new Map() })

  // Agents keyed by their relay pubkey; the picker needs the reverse view.
  const agentChoices = Array.from(directoryRef.current.byPubkey.entries()).map(
    ([pubkey, agent]) => ({ pubkey, agent })
  )

  const refreshChannels = useCallback(async () => {
    const base = await loadDmChannels()
    const withLabels = await withResolvedLabels(base)
    setChannels(withLabels)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init(): Promise<void> {
      setChannelsLoading(true)
      const [, directory] = await Promise.all([refreshChannels(), loadAgentDirectory()])
      if (cancelled) {return}
      directoryRef.current = directory
      setChannelsLoading(false)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [refreshChannels])

  const startDmWithAgent = useCallback(
    async (pubkey: string) => {
      setPickerBusy(pubkey)
      try {
        const channelId = await openDmWithPeer(pubkey)
        await refreshChannels()
        setSelectedChannelId(channelId)
        setPickerOpen(false)
      } finally {
        setPickerBusy(null)
      }
    },
    [refreshChannels]
  )

  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null

  useEffect(() => {
    if (!selectedChannelId) {
      setMessages([])
      return
    }
    const channelId = selectedChannelId
    let cancelled = false
    setMessagesLoading(true)
    async function load(): Promise<void> {
      const loaded = await loadChannelMessages(channelId)
      if (!cancelled) {
        setMessages(loaded)
        setMessagesLoading(false)
      }
    }
    void load()
    const interval = setInterval(() => {
      void load()
    }, MESSAGE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [selectedChannelId])

  useEffect(() => {
    const otherPubkeys = selectedChannel?.otherPubkeys ?? []
    if (otherPubkeys.length === 0) {
      setWorkingAgent(null)
      return
    }
    let cancelled = false
    async function poll(): Promise<void> {
      const agent = await isAgentWorking(otherPubkeys, directoryRef.current)
      if (!cancelled) {setWorkingAgent(agent)}
    }
    void poll()
    const interval = setInterval(() => {
      void poll()
    }, AGENT_STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [selectedChannel?.id, selectedChannel?.otherPubkeys])

  const handleSend = useCallback(
    async (content: string) => {
      if (!selectedChannel) {return}
      const optimistic: ThreadMessage = {
        id: `pending-${Date.now()}`,
        pubkey: 'self',
        content,
        createdAt: Math.floor(Date.now() / 1000),
        edited: false,
        pending: true
      }
      setMessages((current) => [...current, optimistic])

      const eventId = await sendDmMessage(selectedChannel.id, content)
      const refreshed = await loadChannelMessages(selectedChannel.id)
      setMessages(refreshed)

      void dispatchIfAgentDm({
        channelId: selectedChannel.id,
        eventId,
        content,
        otherPubkeys: selectedChannel.otherPubkeys,
        directory: directoryRef.current
      }).then(() => loadChannelMessages(selectedChannel.id).then(setMessages))
    },
    [selectedChannel]
  )

  return (
    // relative: the new-message picker below is an absolutely-positioned overlay
    <div className="buzz-native-theme relative">
      <BuzzInboxSidebar
        channels={channels}
        selectedChannelId={selectedChannelId}
        onSelectChannel={setSelectedChannelId}
        onNewMessage={() => setPickerOpen(true)}
        loading={channelsLoading}
      />
      {pickerOpen ? (
        <div
          className="absolute inset-0 z-20 flex items-start justify-center bg-black/40 pt-24"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-80 rounded-lg border p-2 shadow-lg"
            style={{ background: 'var(--popover)', borderColor: 'var(--border)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-2 py-1.5 text-xs font-medium uppercase opacity-60">Message an agent</div>
            {agentChoices.length === 0 ? (
              <div className="px-2 py-3 text-sm opacity-60">
                No agents yet. Create one in the Agents tab first.
              </div>
            ) : (
              agentChoices.map(({ pubkey, agent }) => (
                <button
                  key={pubkey}
                  type="button"
                  disabled={pickerBusy !== null}
                  onClick={() => void startDmWithAgent(pubkey)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs"
                    style={{ background: 'var(--muted)' }}
                  >
                    {agent.name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <span className="truncate">{agent.name}</span>
                  {pickerBusy === pubkey ? <span className="ml-auto text-xs opacity-60">opening…</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
      <BuzzConversationThread
        channelId={selectedChannel?.id ?? null}
        displayName={selectedChannel?.label ?? ''}
        otherProfile={selectedChannel?.otherProfile ?? null}
        messages={messages}
        loading={messagesLoading}
        workingAgent={workingAgent}
        onSend={(content) => {
          void handleSend(content)
        }}
      />
    </div>
  )
}
