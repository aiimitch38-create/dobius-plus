// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultVoiceSettings } from '../../../../shared/constants'
import type { VoiceSettings } from '../../../../shared/speech-types'
import { JarvisSettingsSection } from './JarvisSettingsSection'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

// Fake value only.
const KEY = 'sk_fake_new_key'

const jarvisApi = {
  status: vi.fn(async () => ({ shortcutActive: true, phase: 'idle' })),
  getElevenLabsKeyStatus: vi.fn(async () => ({ configured: true, sessionOnly: false, unreadable: false })),
  saveElevenLabsKey: vi.fn(async (_key: string) => ({ configured: true, sessionOnly: false, unreadable: false })),
  clearElevenLabsKey: vi.fn(async () => ({ configured: false, sessionOnly: false, unreadable: false })),
  speak: vi.fn()
}

let root: Root | null = null

async function render(
  voice: Partial<VoiceSettings>,
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
): Promise<HTMLDivElement> {
  Object.assign(window, { api: { jarvis: jarvisApi } })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <JarvisSettingsSection
        voiceSettings={{ ...getDefaultVoiceSettings(), ...voice }}
        permissionPending={false}
        onToggleJarvis={vi.fn()}
        onUpdateVoiceSettings={onUpdateVoiceSettings}
      />
    )
  })
  return container
}

function keyInput(container: HTMLDivElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('#jarvis-elevenlabs-key')
  if (!input) {
    throw new Error('key input missing')
  }
  return input
}

function buttonNamed(container: HTMLDivElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === name
  )
  if (!button) {
    throw new Error(`button ${name} missing`)
  }
  return button
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

describe('JarvisSettingsSection ElevenLabs key (#24)', () => {
  beforeEach(() => {
    for (const fn of Object.values(jarvisApi)) {
      fn.mockClear()
    }
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ''
  })

  it('never shows a saved key and says one is saved', async () => {
    const container = await render({ elevenlabsVoiceId: 'voice-a' }, vi.fn())

    expect(keyInput(container).value).toBe('')
    expect(keyInput(container).placeholder).toContain('Key saved')
  })

  it('tells the user to re-enter a saved key this build cannot read (F3)', async () => {
    jarvisApi.getElevenLabsKeyStatus.mockResolvedValueOnce({
      configured: true,
      sessionOnly: false,
      unreadable: true
    })
    const container = await render({ elevenlabsVoiceId: 'voice-a' }, vi.fn())

    expect(keyInput(container).placeholder).toBe("Saved key can't be read on this build. Re-enter it.")
  })

  it('saves a new key through the key store, not through voice settings', async () => {
    const onUpdate = vi.fn()
    const container = await render({ elevenlabsVoiceId: 'voice-a' }, onUpdate)

    await typeInto(keyInput(container), `  ${KEY}  `)
    await click(buttonNamed(container, 'Save'))

    expect(jarvisApi.saveElevenLabsKey).toHaveBeenCalledWith(KEY)
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0]?.[0]).not.toHaveProperty('elevenlabsApiKey')
    expect(keyInput(container).value).toBe('')
  })

  it('editing only the voice ID leaves the saved key alone', async () => {
    const onUpdate = vi.fn()
    const container = await render({ elevenlabsVoiceId: 'voice-a' }, onUpdate)
    const voiceInput = container.querySelector<HTMLInputElement>('#jarvis-elevenlabs-voice')
    if (!voiceInput) {
      throw new Error('voice input missing')
    }

    await typeInto(voiceInput, 'voice-b')
    await click(buttonNamed(container, 'Save'))

    expect(jarvisApi.saveElevenLabsKey).not.toHaveBeenCalled()
    expect(jarvisApi.clearElevenLabsKey).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledWith({ elevenlabsVoiceId: 'voice-b', elevenlabsAgentId: '' })
  })

  it('Remove key clears the stored key', async () => {
    const container = await render({ elevenlabsVoiceId: 'voice-a' }, vi.fn())

    await click(buttonNamed(container, 'Remove key'))

    expect(jarvisApi.clearElevenLabsKey).toHaveBeenCalledOnce()
    expect(keyInput(container).placeholder).toBe('ElevenLabs API key')
  })
})
