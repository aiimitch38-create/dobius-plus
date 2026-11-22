import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}))

vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

async function loadVoice(savedVoice?: Record<string, unknown>) {
  if (savedVoice) {
    mkdirSync(testState.dir, { recursive: true })
    writeFileSync(
      join(testState.dir, 'dobius-data.json'),
      JSON.stringify({ settings: { voice: savedVoice } }),
      'utf-8'
    )
  }
  vi.resetModules()
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  return new Store().getSettings().voice
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'dobius-live-voice-'))
})

afterEach(() => {
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('Store live voice engine migration', () => {
  it('a fresh profile starts on OpenAI Live', async () => {
    expect((await loadVoice())?.liveVoiceEngine).toBe('openai-live')
  })

  it('moves settings saved before the engine choice existed to OpenAI Live', async () => {
    const voice = await loadVoice({ jarvisEnabled: true, elevenlabsAgentId: 'agent_1' })
    expect(voice).toMatchObject({
      jarvisEnabled: true,
      liveVoiceEngine: 'openai-live',
      openAiLiveVoice: 'marin',
      liveVoiceMicMode: 'push-to-talk',
      liveVoiceDailyCapUsd: 15,
      liveVoiceIdleTimeoutSec: 30
    })
  })

  it('keeps someone who explicitly switched to the ElevenLabs conversation', async () => {
    const voice = await loadVoice({ preferNativeAdamVoice: false, elevenlabsAgentId: 'agent_1' })
    expect(voice?.liveVoiceEngine).toBe('elevenlabs')
  })

  it('loads a damaged voice object without throwing', async () => {
    const voice = await loadVoice({
      preferNativeAdamVoice: false,
      elevenlabsAgentId: 42,
      liveVoiceEngine: { nope: true }
    })
    expect(voice?.liveVoiceEngine).toBe('openai-live')
  })

  it('keeps an engine the user picked', async () => {
    expect((await loadVoice({ liveVoiceEngine: 'hermes' }))?.liveVoiceEngine).toBe('hermes')
  })
})
