import { useCallback, useEffect, useRef, useState } from 'react'
import { Conversation } from '@elevenlabs/client'
import { createVoiceAgentClientTools } from './voice-agent-client-tools'

export type VoiceAgentState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

/**
 * Hang up after this much silence.
 *
 * Why: ElevenLabs bills connected minutes, not words, so an open call left
 * sitting costs exactly as much as one being used. Real transcripts showed
 * multi-minute stretches of the agent asking "still there?" into dead air.
 */
const IDLE_HANGUP_MS = 60_000

export type VoiceAgent = {
  state: VoiceAgentState
  errorText: string | null
  /** True while a live conversation is open. */
  active: boolean
  toggle: () => void
  getAudioLevel: () => number
}

type LiveConversation = Awaited<ReturnType<typeof Conversation.startSession>>

/**
 * One live conversation with an ElevenLabs agent.
 *
 * Why the renderer owns the socket: the SDK needs getUserMedia and Web Audio
 * for playback, both of which only exist here. Main mints the signed URL, so
 * the API key never crosses into this process.
 */
export function useVoiceAgent(): VoiceAgent {
  const [state, setState] = useState<VoiceAgentState>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)
  const conversationRef = useRef<LiveConversation | null>(null)
  const idleTimerRef = useRef<number | null>(null)
  // Why a ref guard: ⌘T can fire again while startSession is still awaiting,
  // and two sessions would each hold the microphone.
  const startingRef = useRef(false)

  const clearIdleTimer = useCallback((): void => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    clearIdleTimer()
    const conversation = conversationRef.current
    conversationRef.current = null
    setState('idle')
    if (conversation) {
      await conversation.endSession().catch(() => undefined)
    }
  }, [clearIdleTimer])

  const start = useCallback(async (): Promise<void> => {
    if (startingRef.current || conversationRef.current) {
      return
    }
    startingRef.current = true
    setErrorText(null)
    setState('connecting')
    const touchIdle = (): void => {
      clearIdleTimer()
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null
        void stop()
      }, IDLE_HANGUP_MS)
    }
    touchIdle()
    try {
      const signed = await window.api.jarvis.agentSignedUrl()
      if (!signed.ok) {
        throw new Error(signed.error)
      }
      // Why fetched before connecting: the agent's first_message is
      // "{{opening}}", so this value IS the greeting. It is grounded in the
      // user's most recent terminal, which keeps every call from opening the
      // same canned way.
      const opening = await window.api.jarvis.agentOpening().catch(() => '')
      // Explicit entries for the plugins main actually loaded. The map also
      // falls back for any name not listed, so a sync that ran after this
      // fetch still dispatches — this is the fast path, not the only one.
      const pluginToolNames = await window.api.jarvis.pluginToolNames().catch(() => [])
      conversationRef.current = await Conversation.startSession({
        signedUrl: signed.url,
        ...(opening ? { dynamicVariables: { opening } } : {}),
        clientTools: createVoiceAgentClientTools(pluginToolNames),
        onModeChange: ({ mode }) => {
          setState(mode === 'speaking' ? 'speaking' : 'listening')
          touchIdle()
        },
        onMessage: () => touchIdle(),
        onStatusChange: ({ status }) => {
          if (status === 'connected') {
            setState((current) => (current === 'connecting' ? 'listening' : current))
            // Why push instead of waiting to be asked: the agent should open the
            // call already knowing what is running, not interrogate the user.
            void window.api.jarvis
              .agentContext()
              .then((context) => conversationRef.current?.sendContextualUpdate(context))
              .catch(() => undefined)
            // Memory arrives separately: it costs an API round-trip, and the
            // call should not wait on it to start.
            void window.api.jarvis
              .conversationMemory()
              .then((memory) => {
                if (memory) {
                  conversationRef.current?.sendContextualUpdate(memory)
                }
              })
              .catch(() => undefined)
          }
          if (status === 'disconnected') {
            conversationRef.current = null
            setState('idle')
          }
        },
        onError: (message) => {
          setErrorText(message)
          setState('error')
        }
      })
    } catch (error) {
      conversationRef.current = null
      setErrorText(error instanceof Error ? error.message : String(error))
      setState('error')
    } finally {
      startingRef.current = false
    }
  }, [clearIdleTimer, stop])

  const toggle = useCallback((): void => {
    if (conversationRef.current || startingRef.current) {
      void stop()
      return
    }
    void start()
  }, [start, stop])

  useEffect(() => () => void stop(), [stop])

  const getAudioLevel = useCallback((): number => {
    const conversation = conversationRef.current
    if (!conversation) {
      return 0
    }
    // Show whichever side is making sound, so the orb pulses for both halves
    // of the conversation instead of going flat while the agent talks.
    return Math.max(conversation.getInputVolume(), conversation.getOutputVolume())
  }, [])

  return {
    state,
    errorText,
    active: state !== 'idle' && state !== 'error',
    toggle,
    getAudioLevel
  }
}
