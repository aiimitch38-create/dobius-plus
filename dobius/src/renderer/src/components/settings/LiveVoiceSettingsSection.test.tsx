// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultVoiceSettings } from '../../../../shared/constants'
import type { VoiceSettings } from '../../../../shared/speech-types'
import { LiveVoiceSettingsSection } from './LiveVoiceSettingsSection'

const liveSessionConnect = vi.fn()

let root: Root | null = null

async function rerender(
  voice: Partial<VoiceSettings>,
  onUpdate: (updates: Partial<VoiceSettings>) => void = vi.fn(),
  onOpenDialog: () => void = vi.fn()
): Promise<void> {
  await act(async () => {
    root?.render(
      <LiveVoiceSettingsSection
        voiceSettings={{ ...getDefaultVoiceSettings(), ...voice }}
        onUpdateVoiceSettings={onUpdate}
        onOpenOpenAiDialog={onOpenDialog}
      />
    )
  })
}

async function render(
  voice: Partial<VoiceSettings>,
  onUpdate: (updates: Partial<VoiceSettings>) => void = vi.fn(),
  onOpenDialog: () => void = vi.fn()
): Promise<HTMLDivElement> {
  Object.assign(window, { api: { jarvis: { liveSessionConnect } } })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await rerender(voice, onUpdate, onOpenDialog)
  return container
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.startsWith(name)
  )
  if (!button) {
    throw new Error(`button ${name} missing`)
  }
  return button
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

async function typeAndBlur(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

function input(container: HTMLElement, id: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!found) {
    throw new Error(`input ${id} missing`)
  }
  return found
}

describe('LiveVoiceSettingsSection', () => {
  beforeEach(() => {
    liveSessionConnect.mockClear()
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ''
  })

  it('selects OpenAI Live by default and asks for a key when none is saved', async () => {
    const onOpenDialog = vi.fn()
    const container = await render({}, vi.fn(), onOpenDialog)

    expect(buttonNamed(container, 'OpenAI Live').getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('Add your OpenAI API key to use live voice.')
    expect(container.textContent).toContain(
      'Until a key is saved, voice keeps working on Hermes turns.'
    )
    expect(container.querySelector('[data-testid="openai-key-status"]')?.textContent).toBe(
      'Key: not set'
    )

    await click(buttonNamed(container, 'Add API key'))
    expect(onOpenDialog).toHaveBeenCalledOnce()
  })

  it('shows only that a key is set, and drops the prompt', async () => {
    const container = await render({ openAiApiKeyConfigured: true })

    expect(container.querySelector('[data-testid="openai-key-status"]')?.textContent).toBe(
      'Key: set'
    )
    expect(container.textContent).not.toContain('Add your OpenAI API key to use live voice.')
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  it('does not ask for a key when another engine is chosen', async () => {
    const container = await render({ liveVoiceEngine: 'hermes' })
    expect(container.textContent).not.toContain('Add your OpenAI API key to use live voice.')
  })

  it('keeps the other two engines selectable', async () => {
    const onUpdate = vi.fn()
    const container = await render({}, onUpdate)

    await click(buttonNamed(container, 'Hermes turns'))
    expect(onUpdate).toHaveBeenLastCalledWith({
      liveVoiceEngine: 'hermes',
      preferNativeAdamVoice: true
    })
    await click(buttonNamed(container, 'ElevenLabs'))
    expect(onUpdate).toHaveBeenLastCalledWith({
      liveVoiceEngine: 'elevenlabs',
      preferNativeAdamVoice: false
    })
    await click(buttonNamed(container, 'OpenAI Live'))
    expect(onUpdate).toHaveBeenLastCalledWith({ liveVoiceEngine: 'openai-live' })
  })

  it('saves the voice, microphone mode, cap and idle timeout within their limits', async () => {
    const onUpdate = vi.fn()
    const container = await render({}, onUpdate)

    expect(input(container, 'live-voice-name').value).toBe('marin')
    expect(input(container, 'live-voice-daily-cap').value).toBe('15')
    expect(input(container, 'live-voice-idle-timeout').value).toBe('30')
    expect(buttonNamed(container, 'Push-to-talk').getAttribute('aria-checked')).toBe('true')

    await typeAndBlur(input(container, 'live-voice-name'), 'Cedar')
    expect(onUpdate).toHaveBeenLastCalledWith({ openAiLiveVoice: 'cedar' })
    await typeAndBlur(input(container, 'live-voice-daily-cap'), '9999')
    expect(onUpdate).toHaveBeenLastCalledWith({ liveVoiceDailyCapUsd: 500 })
    await typeAndBlur(input(container, 'live-voice-idle-timeout'), '2')
    expect(onUpdate).toHaveBeenLastCalledWith({ liveVoiceIdleTimeoutSec: 5 })
    await click(buttonNamed(container, 'Hands-free'))
    expect(onUpdate).toHaveBeenLastCalledWith({ liveVoiceMicMode: 'hands-free' })
  })

  it('says the spending cap is enforced', async () => {
    const container = await render({})
    expect(container.textContent).toContain('Enforced. ADAM warns at 80 percent.')
    expect(container.textContent).not.toContain('Not enforced yet')
  })

  it('keeps Test connection disabled, with or without a key, and says when it comes back', async () => {
    for (const keySaved of [false, true]) {
      const container = await render({ openAiApiKeyConfigured: keySaved })
      const button = buttonNamed(container, 'Test connection')
      expect(button.disabled).toBe(true)
      expect(container.querySelector('[data-testid="live-test-note"]')?.textContent).toBe(
        'A test would start a billed call. Press the orb to make a real one.'
      )
      await click(button)
      act(() => root?.unmount())
      document.body.innerHTML = ''
    }
    expect(liveSessionConnect).not.toHaveBeenCalled()
  })

  it('keeps "Read ADAM\'s facts word for word" off by default and saves the switch', async () => {
    const onUpdate = vi.fn()
    const container = await render({}, onUpdate)
    const toggle = container.querySelector<HTMLButtonElement>('#adam-read-facts-verbatim')
    expect(container.textContent).toContain('Read ADAM’s facts word for word')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    await click(toggle!)
    expect(onUpdate).toHaveBeenCalledWith({ adamReadFactsVerbatim: true })
    await rerender({ adamReadFactsVerbatim: true }, onUpdate)
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    await click(toggle!)
    expect(onUpdate).toHaveBeenLastCalledWith({ adamReadFactsVerbatim: false })
  })
})
