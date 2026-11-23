import type { DataChannelLike, LiveVoiceCallDeps, PeerLike } from './live-voice-call-types'

type Handler = DataChannelLike['onmessage']

/**
 * Lets `heard` see every data-channel message the call receives, without
 * changing the call. Why through the `onmessage` property: that is how the
 * call listens (live-voice-peer.ts). A native setter (RTCDataChannel) still
 * gets the handler, wrapped; a plain object keeps it here.
 */
function tapChannel(channel: DataChannelLike, heard: (data: unknown) => void): DataChannelLike {
  let native: PropertyDescriptor | undefined
  for (let at: object | null = channel; at && !native; at = Object.getPrototypeOf(at)) {
    native = Object.getOwnPropertyDescriptor(at, 'onmessage')
  }
  let inner: Handler = null
  const forward: NonNullable<Handler> = (message) => {
    heard(message.data)
    inner?.(message)
  }
  const setter = native?.set
  Object.defineProperty(channel, 'onmessage', {
    configurable: true,
    get: () => (setter ? inner : inner && forward),
    set: (handler: Handler) => {
      inner = handler
      setter?.call(channel, handler ? forward : null)
    }
  })
  return channel
}

export function tapLiveMessages(
  deps: LiveVoiceCallDeps,
  heard: (data: unknown) => void
): LiveVoiceCallDeps {
  return {
    ...deps,
    createPeer: (): PeerLike => {
      const peer = deps.createPeer()
      const create = peer.createDataChannel.bind(peer)
      peer.createDataChannel = (label) => tapChannel(create(label), heard)
      return peer
    }
  }
}
