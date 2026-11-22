import type { LivePeerCall, LiveVoiceCallDeps } from './live-voice-call-types'
import { LIVE_DATA_CHANNEL } from './live-voice-wire'

export type LivePeerHandlers = {
  onMessage: (data: unknown) => void
  /** The channel closed or the connection failed without a hang-up. */
  onDropped: (why: string) => void
  /** The voice's audio arrived; the stream is for playback and the orb level. */
  onRemoteStream: (stream: unknown) => void
}

/**
 * Builds one WebRTC leg: the microphone track, the `oai-events` data channel
 * and the local offer. Main turns the offer into a session; the caller
 * applies the answer. Handlers fire only while `isCurrent()` holds, and a leg
 * opened for a call that was hung up meanwhile is closed and null returned.
 */
export async function openLivePeer(
  deps: LiveVoiceCallDeps,
  muted: boolean,
  isCurrent: () => boolean,
  handlers: LivePeerHandlers
): Promise<{ call: LivePeerCall; offerSdp: string } | null> {
  const mic = await deps.getMicrophone()
  if (!isCurrent()) {
    mic.getTracks().forEach((track) => track.stop())
    return null
  }
  const peer = deps.createPeer()
  for (const track of mic.getAudioTracks()) {
    track.enabled = !muted
    peer.addTrack(track, mic)
  }
  const channel = peer.createDataChannel(LIVE_DATA_CHANNEL)
  const call: LivePeerCall = { peer, channel, mic, connected: false, stopAudio: null }
  peer.ontrack = (event) => {
    const stream = event.streams[0]
    if (stream && isCurrent()) {
      call.stopAudio?.()
      call.stopAudio = deps.playRemote(stream)
      handlers.onRemoteStream(stream)
    }
  }
  channel.onmessage = (message) => isCurrent() && handlers.onMessage(message.data)
  channel.onclose = () => isCurrent() && handlers.onDropped('the voice channel closed')
  peer.onconnectionstatechange = () => {
    if (isCurrent() && peer.connectionState === 'failed') {
      handlers.onDropped('the connection failed')
    }
  }
  try {
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    if (isCurrent()) {
      return { call, offerSdp: offer.sdp ?? '' }
    }
  } catch (error) {
    closeLivePeer(call)
    throw error
  }
  closeLivePeer(call)
  return null
}

/** Stops audio and the microphone and closes the peer; safe to call twice. */
export function closeLivePeer(call: LivePeerCall): void {
  call.channel.onmessage = null
  call.channel.onclose = null
  call.peer.ontrack = null
  call.peer.onconnectionstatechange = null
  call.stopAudio?.()
  call.stopAudio = null
  try {
    call.channel.close()
  } catch {
    // Already closed.
  }
  call.peer.close()
  call.mic.getTracks().forEach((track) => track.stop())
}
