// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { VoiceSettings } from '../../../../shared/speech-types'
import { VoiceEngineSection } from './VoiceEngineSection'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function makeVoice(overrides: Partial<VoiceSettings> = {}): VoiceSettings {
  return {
    enabled: false,
    sttModel: '',
    modelsDir: '',
    language: 'en',
    dictationMode: 'toggle',
    terminalConfirmBeforeInsert: false,
    userModels: [],
    openAiApiKeyConfigured: false,
    conductorEnabled: false,
    ...overrides
  }
}

function renderSection(
  voice: Partial<VoiceSettings> = {},
  runBakeoff: () => Promise<unknown> = async () => ({ winner: 'kokoro', runs: [], reportPath: '/tmp/BAKEOFF.md' })
) {
  vi.stubGlobal('window', Object.assign(window, { api: { speech: { runBakeoff } } }))
  const onUpdateVoiceSettings = vi.fn()
  const user = userEvent.setup()
  render(
    <VoiceEngineSection voiceSettings={makeVoice(voice)} onUpdateVoiceSettings={onUpdateVoiceSettings} />
  )
  return { user, onUpdateVoiceSettings }
}

describe('VoiceEngineSection', () => {
  it('defaults to local, showing the local voice picker', () => {
    renderSection()
    expect(screen.getByRole('button', { name: 'Local' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Kokoro' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('persists the engine choice', async () => {
    const { user, onUpdateVoiceSettings } = renderSection()
    await user.click(screen.getByRole('button', { name: 'ElevenLabs' }))
    expect(onUpdateVoiceSettings).toHaveBeenCalledWith({ voiceEngine: 'elevenlabs' })
  })

  it('persists the local voice choice', async () => {
    const { user, onUpdateVoiceSettings } = renderSection()
    await user.click(screen.getByRole('button', { name: 'Supertonic' }))
    expect(onUpdateVoiceSettings).toHaveBeenCalledWith({ localTtsEngine: 'supertonic' })
  })

  it('hides the local voice picker in ElevenLabs mode', () => {
    renderSection({ voiceEngine: 'elevenlabs' })
    expect(screen.queryByRole('button', { name: 'Kokoro' })).not.toBeInTheDocument()
  })

  it('runs the bake-off and surfaces the report path', async () => {
    const runBakeoff = vi.fn(async () => ({
      winner: 'supertonic',
      runs: [],
      reportPath: '/models/BAKEOFF.md'
    }))
    const { user } = renderSection({}, runBakeoff)
    await user.click(screen.getByRole('button', { name: 'Run bake-off' }))
    expect(runBakeoff).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('/models/BAKEOFF.md')).toBeInTheDocument())
  })
})
