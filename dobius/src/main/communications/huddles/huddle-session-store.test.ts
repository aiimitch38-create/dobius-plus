import { beforeEach, describe, expect, it } from 'vitest'
import { createHuddleSessionStore, type HuddleSessionStore } from './huddle-session-store'

describe('HuddleSessionStore', () => {
  let store: HuddleSessionStore

  beforeEach(() => {
    store = createHuddleSessionStore()
  })

  it('starts idle with default preferences', () => {
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      parent_channel_id: null,
      ephemeral_channel_id: null,
      participants: [],
      agent_pubkeys: [],
      tts_enabled: true,
      transcription_enabled: true,
      is_creator: false,
      voice_input_mode: 'voice_activity'
    })
  })

  describe('start', () => {
    it('creates a huddle as creator, deduping the caller into participants', () => {
      const result = store.start({
        parentChannelId: 'parent-1',
        memberPubkeys: ['agent-a', 'caller-1'],
        callerPubkey: 'caller-1'
      })

      expect(result.ephemeral_channel_id).toMatch(/^huddle-/)
      const state = store.getState()
      expect(state.phase).toBe('creating')
      expect(state.parent_channel_id).toBe('parent-1')
      expect(state.ephemeral_channel_id).toBe(result.ephemeral_channel_id)
      expect(state.is_creator).toBe(true)
      expect(state.participants).toEqual(['caller-1', 'agent-a'])
    })

    it('rejects a second start with the exact Rust-compatible phase message', () => {
      store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'caller-1' })

      expect(() =>
        store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'caller-1' })
      ).toThrow('cannot start huddle: already in phase creating')
    })
  })

  describe('join', () => {
    it('joins an existing ephemeral channel as a non-creator', () => {
      const result = store.join({
        parentChannelId: 'parent-1',
        ephemeralChannelId: 'huddle-existing',
        callerPubkey: 'caller-2'
      })

      expect(result).toEqual({ ephemeral_channel_id: 'huddle-existing' })
      const state = store.getState()
      expect(state.phase).toBe('connecting')
      expect(state.is_creator).toBe(false)
      expect(state.participants).toEqual(['caller-2'])
    })

    it('rejects joining while already in a huddle, matching the join phase message', () => {
      store.join({ parentChannelId: 'p', ephemeralChannelId: 'e', callerPubkey: 'c' })

      expect(() =>
        store.join({ parentChannelId: 'p', ephemeralChannelId: 'e2', callerPubkey: 'c' })
      ).toThrow('cannot join huddle: already in phase connecting')
    })
  })

  describe('confirmActive', () => {
    it('transitions an in-progress huddle to active', () => {
      store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
      const state = store.confirmActive()
      expect(state.phase).toBe('active')
    })

    it('throws when there is no huddle in progress', () => {
      expect(() => store.confirmActive()).toThrow('no huddle in progress')
    })
  })

  describe('addAgent', () => {
    it('adds an agent pubkey to both participants and agent_pubkeys', () => {
      store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
      const state = store.addAgent({ pubkey: 'agent-x' })
      expect(state.participants).toContain('agent-x')
      expect(state.agent_pubkeys).toEqual(['agent-x'])
    })

    it('is idempotent for the same agent pubkey', () => {
      store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
      store.addAgent({ pubkey: 'agent-x' })
      const state = store.addAgent({ pubkey: 'agent-x' })
      expect(state.agent_pubkeys).toEqual(['agent-x'])
    })

    it('rejects adding an agent with no active huddle', () => {
      expect(() => store.addAgent({ pubkey: 'agent-x' })).toThrow('no active huddle')
    })
  })

  describe('leave', () => {
    it('resets to idle from any in-progress phase', () => {
      store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
      store.confirmActive()
      const state = store.leave()
      expect(state.phase).toBe('idle')
      expect(state.ephemeral_channel_id).toBeNull()
      expect(state.participants).toEqual([])
    })

    it('is idempotent when already idle', () => {
      expect(() => store.leave()).not.toThrow()
      expect(store.getState().phase).toBe('idle')
    })

    it('preserves the voice input mode preference across a leave', () => {
      store.setVoiceInputMode('push_to_talk')
      store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
      store.leave()
      expect(store.getState().voice_input_mode).toBe('push_to_talk')
    })
  })

  describe('end', () => {
    it('resets to idle like leave, regardless of creator status', () => {
      store.join({ parentChannelId: 'p', ephemeralChannelId: 'e', callerPubkey: 'c' })
      const state = store.end()
      expect(state.phase).toBe('idle')
      expect(state.is_creator).toBe(false)
    })
  })

  describe('reconnectAudio', () => {
    it('re-affirms an in-progress huddle without changing its phase', () => {
      store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
      store.confirmActive()
      const state = store.reconnectAudio()
      expect(state.phase).toBe('active')
    })

    it('throws when there is no active huddle to reconnect', () => {
      expect(() => store.reconnectAudio()).toThrow('no active huddle')
    })
  })

  describe('voice input mode', () => {
    it('updates immediately and is reflected in state', () => {
      const state = store.setVoiceInputMode('push_to_talk')
      expect(state.voice_input_mode).toBe('push_to_talk')
    })
  })

  describe('transcription and TTS toggles', () => {
    it('requires an active huddle to toggle transcription', () => {
      expect(() => store.setTranscriptionEnabled(false)).toThrow('no active huddle')
    })

    it('requires an active huddle to toggle TTS', () => {
      expect(() => store.setTtsEnabled(false)).toThrow('no active huddle')
    })

    it('toggles both flags while a huddle is in progress', () => {
      store.start({ parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
      expect(store.setTranscriptionEnabled(false).transcription_enabled).toBe(false)
      expect(store.setTtsEnabled(false).tts_enabled).toBe(false)
    })
  })

  it('getState returns a defensive copy, not a live reference', () => {
    store.start({ parentChannelId: 'p', memberPubkeys: ['agent-a'], callerPubkey: 'c' })
    const snapshot = store.getState()
    snapshot.participants.push('tampered')
    expect(store.getState().participants).not.toContain('tampered')
  })
})
