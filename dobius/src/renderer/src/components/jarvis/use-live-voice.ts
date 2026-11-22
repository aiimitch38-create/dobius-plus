import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveVoiceMicMode } from '../../../../shared/speech-types'
import { LiveVoiceCall } from './live-voice-call'
import type {
  LiveVoiceCallDeps,
  LiveVoiceSnapshot,
  LiveVoiceState,
  LevelReader,
  MicStreamLike,
  PeerLike
} from './live-voice-call-types'

export type LiveVoice = {
  state: LiveVoiceState
  muted: boolean
  errorText: string | null
  /** True while a call is open or connecting. */
  active: boolean
  /** The orb and Cmd+T: start, mute or unmute (push-to-talk), or hang up. */
  press: () => void
  hangUp: () => void
  getInputLevel: () => number
  getOutputLevel: () => number
}

/** Reads a 0..1 level from a stream for the orb; null when Web Audio is missing. */
function streamLevel(stream: unknown): LevelReader | null {
  if (typeof AudioContext === 'undefined' || !(stream instanceof MediaStream)) {
    return null
  }
  try {
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    return {
      read: () => {
        if (context.state === 'closed') {
          return 0
        }
        analyser.getByteTimeDomainData(samples)
        let peak = 0
        for (const sample of samples) {
          peak = Math.max(peak, Math.abs(sample - 128) / 128)
        }
        return Math.min(1, peak * 1.5)
      },
      // Why explicit: track.stop() fires no 'ended' event, and Chromium
      // limits how many AudioContexts a page may hold open.
      dispose: () => void context.close().catch(() => undefined)
    }
  } catch {
    return null
  }
}

function browserDeps(): LiveVoiceCallDeps {
  return {
    api: window.api.jarvis,
    createPeer: () => new RTCPeerConnection() as unknown as PeerLike,
    getMicrophone: async () =>
      (await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })) as unknown as MicStreamLike,
    playRemote: (stream) => {
      const audio = new Audio()
      audio.autoplay = true
      audio.srcObject = stream as MediaStream
      void audio.play().catch(() => undefined)
      return () => {
        audio.pause()
        audio.srcObject = null
      }
    },
    levelOf: streamLevel
  }
}

/**
 * The OpenAI Live call in the window: microphone, WebRTC and the data channel.
 * Main holds the key, creates the session, meters it and talks to ADAM.
 */
export function useLiveVoice(
  micMode: LiveVoiceMicMode,
  makeDeps: () => LiveVoiceCallDeps = browserDeps
): LiveVoice {
  const [snapshot, setSnapshot] = useState<LiveVoiceSnapshot>({
    state: 'idle',
    muted: false,
    errorText: null
  })
  const callRef = useRef<LiveVoiceCall | null>(null)
  const makeDepsRef = useRef(makeDeps)
  const micModeRef = useRef(micMode)
  micModeRef.current = micMode

  const getCall = useCallback((): LiveVoiceCall => {
    callRef.current ??= new LiveVoiceCall(makeDepsRef.current(), setSnapshot)
    return callRef.current
  }, [])

  useEffect(
    () =>
      window.api.jarvis.onLiveNotice((notice) => {
        callRef.current?.notice(notice)
      }),
    []
  )

  useEffect(
    () => () => {
      void callRef.current?.hangUp()
      callRef.current = null
    },
    []
  )

  const press = useCallback((): void => getCall().press(micModeRef.current), [getCall])
  const hangUp = useCallback((): void => {
    void callRef.current?.hangUp()
  }, [])
  const getInputLevel = useCallback((): number => callRef.current?.getInputLevel() ?? 0, [])
  const getOutputLevel = useCallback((): number => callRef.current?.getOutputLevel() ?? 0, [])

  return {
    state: snapshot.state,
    muted: snapshot.muted,
    errorText: snapshot.errorText,
    active: snapshot.state !== 'idle' && snapshot.state !== 'error',
    press,
    hangUp,
    getInputLevel,
    getOutputLevel
  }
}
