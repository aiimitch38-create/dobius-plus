import { useEffect, useState } from 'react'
import {
  LIVE_VOICE_DAILY_CAP_MAX_USD,
  LIVE_VOICE_DAILY_CAP_MIN_USD,
  LIVE_VOICE_IDLE_TIMEOUT_MAX_SEC,
  LIVE_VOICE_IDLE_TIMEOUT_MIN_SEC,
  OPENAI_LIVE_CALL_READY,
  normalizeLiveVoiceDailyCapUsd,
  normalizeLiveVoiceIdleTimeoutSec,
  normalizeOpenAiLiveVoice,
  resolveActiveVoiceEngine,
  resolveLiveVoiceSettings
} from '../../../../shared/live-voice-settings'
import type {
  LiveVoiceEngine,
  LiveVoiceMicMode,
  OpenAiLiveTestResult,
  VoiceSettings
} from '../../../../shared/speech-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

type LiveVoiceSettingsSectionProps = {
  voiceSettings: VoiceSettings
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
  /** Opens the shared OpenAI key dialog owned by the Voice pane. */
  onOpenOpenAiDialog: () => void
}

const ENGINES: { id: LiveVoiceEngine; label: string; hint: string }[] = [
  {
    id: 'openai-live',
    label: 'OpenAI Live',
    hint: 'A natural back-and-forth conversation you can interrupt.'
  },
  {
    id: 'hermes',
    label: 'Hermes turns',
    hint: "ADAM's own brain, one question at a time."
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    hint: 'The ElevenLabs live agent. Needs an agent ID below.'
  }
]

const MIC_MODES: { id: LiveVoiceMicMode; label: string }[] = [
  { id: 'push-to-talk', label: 'Push-to-talk' },
  { id: 'hands-free', label: 'Hands-free' }
]

const ENGINE_NAMES: Record<LiveVoiceEngine, string> = {
  'openai-live': 'OpenAI Live',
  hermes: 'Hermes turns',
  elevenlabs: 'ElevenLabs'
}

const CHOICE_CLASS =
  'rounded-md border border-border px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 aria-checked:border-[var(--board-accent)] aria-checked:bg-[var(--board-accent-tint)]'

// Why plain literals, not translate(): same convention as JarvisSettingsSection
// (experimental copy ships without localization catalog entries).
export function LiveVoiceSettingsSection({
  voiceSettings,
  onUpdateVoiceSettings,
  onOpenOpenAiDialog
}: LiveVoiceSettingsSectionProps): React.JSX.Element {
  const live = resolveLiveVoiceSettings(voiceSettings)
  const activeEngine = resolveActiveVoiceEngine(voiceSettings)
  const keySaved = voiceSettings.openAiApiKeyConfigured === true
  // Why drafts: number and name fields are committed on blur so a half-typed
  // value ("1" on the way to "15") is never saved as the spending cap.
  const [voiceDraft, setVoiceDraft] = useState(live.voice)
  const [capDraft, setCapDraft] = useState(String(live.dailyCapUsd))
  const [idleDraft, setIdleDraft] = useState(String(live.idleTimeoutSec))
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<OpenAiLiveTestResult | null>(null)

  useEffect(() => {
    setVoiceDraft(live.voice)
    setCapDraft(String(live.dailyCapUsd))
    setIdleDraft(String(live.idleTimeoutSec))
  }, [live.voice, live.dailyCapUsd, live.idleTimeoutSec])

  // A result from the old key says nothing about a new or removed one.
  useEffect(() => {
    setTestResult(null)
  }, [keySaved])

  const chooseEngine = (engine: LiveVoiceEngine): void => {
    if (engine === 'openai-live') {
      // Why preferNativeAdamVoice is left alone: it remembers the engine to
      // fall back to while OpenAI Live cannot run.
      onUpdateVoiceSettings({ liveVoiceEngine: engine })
      return
    }
    onUpdateVoiceSettings({
      liveVoiceEngine: engine,
      preferNativeAdamVoice: engine === 'hermes'
    })
  }

  const commitVoice = (): void => {
    const voice = normalizeOpenAiLiveVoice(voiceDraft)
    setVoiceDraft(voice)
    if (voice !== live.voice) {
      onUpdateVoiceSettings({ openAiLiveVoice: voice })
    }
  }

  const commitCap = (): void => {
    const parsed = Number.parseFloat(capDraft)
    const cap = normalizeLiveVoiceDailyCapUsd(Number.isFinite(parsed) ? parsed : live.dailyCapUsd)
    setCapDraft(String(cap))
    if (cap !== live.dailyCapUsd) {
      onUpdateVoiceSettings({ liveVoiceDailyCapUsd: cap })
    }
  }

  const commitIdle = (): void => {
    const parsed = Number.parseFloat(idleDraft)
    const idle = normalizeLiveVoiceIdleTimeoutSec(
      Number.isFinite(parsed) ? parsed : live.idleTimeoutSec
    )
    setIdleDraft(String(idle))
    if (idle !== live.idleTimeoutSec) {
      onUpdateVoiceSettings({ liveVoiceIdleTimeoutSec: idle })
    }
  }

  const testConnection = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await window.api.jarvis.liveSessionTest())
    } catch {
      setTestResult({
        ok: false,
        kind: 'bad-response',
        error: 'The connection test could not run. Try again.'
      })
    } finally {
      setTesting(false)
    }
  }

  const fallbackNote = ((): string | null => {
    if (live.engine !== 'openai-live' || activeEngine === 'openai-live') {
      return null
    }
    const running = ENGINE_NAMES[activeEngine]
    if (!keySaved) {
      return `Until a key is saved, voice keeps working on ${running}.`
    }
    return OPENAI_LIVE_CALL_READY
      ? null
      : `The live call is still being built. Until it ships, voice keeps working on ${running}.`
  })()

  return (
    <div className="space-y-3 py-2" data-testid="live-voice-settings">
      <div className="space-y-1.5">
        <Label>Voice engine</Label>
        <p className="text-xs text-muted-foreground">
          Which voice ADAM uses when you talk to the orb.
        </p>
        <div role="radiogroup" aria-label="Voice engine" className="grid gap-1.5 sm:grid-cols-3">
          {ENGINES.map((engine) => (
            <button
              key={engine.id}
              type="button"
              role="radio"
              aria-checked={live.engine === engine.id}
              onClick={() => chooseEngine(engine.id)}
              className={CHOICE_CLASS}
            >
              <span className="block font-medium text-foreground">{engine.label}</span>
              <span className="block text-muted-foreground">{engine.hint}</span>
            </button>
          ))}
        </div>
        {live.engine === 'openai-live' && !keySaved ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--board-accent)] bg-[var(--board-accent-tint)] px-3 py-2"
          >
            <p className="text-xs font-medium text-foreground">
              Add your OpenAI API key to use live voice.
            </p>
            <Button size="sm" onClick={onOpenOpenAiDialog}>
              Add API key
            </Button>
          </div>
        ) : null}
        {fallbackNote ? <p className="text-xs text-muted-foreground">{fallbackNote}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label>OpenAI API key</Label>
        <p className="text-xs text-muted-foreground">
          Used for OpenAI Live voice and OpenAI transcription. It needs an API key from the OpenAI
          developer platform with billing set up. A ChatGPT subscription does not include API use.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground" data-testid="openai-key-status">
            {keySaved ? 'Key: set' : 'Key: not set'}
          </span>
          <Button size="sm" variant="outline" onClick={onOpenOpenAiDialog}>
            {keySaved ? 'Replace or remove key' : 'Add API key'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void testConnection()}
            disabled={testing || !keySaved}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
        </div>
        {testResult ? (
          <p
            role="status"
            className={`text-xs ${testResult.ok ? 'text-foreground' : 'text-destructive'}`}
          >
            {testResult.ok ? testResult.message : testResult.error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="live-voice-name">Voice name</Label>
          <Input
            id="live-voice-name"
            autoComplete="off"
            spellCheck={false}
            value={voiceDraft}
            onChange={(event) => setVoiceDraft(event.target.value)}
            onBlur={commitVoice}
          />
          <p className="text-xs text-muted-foreground">
            The OpenAI Live voice. It cannot change in the middle of a conversation.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Microphone</Label>
          <div role="radiogroup" aria-label="Microphone" className="flex gap-1.5">
            {MIC_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={live.micMode === mode.id}
                onClick={() => onUpdateVoiceSettings({ liveVoiceMicMode: mode.id })}
                className={CHOICE_CLASS}
              >
                <span className="font-medium text-foreground">{mode.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Push-to-talk keeps the microphone off until you press the shortcut. Hands-free listens
            the whole time.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="live-voice-daily-cap">Daily spending cap (US dollars)</Label>
          <Input
            id="live-voice-daily-cap"
            type="number"
            inputMode="decimal"
            min={LIVE_VOICE_DAILY_CAP_MIN_USD}
            max={LIVE_VOICE_DAILY_CAP_MAX_USD}
            step={1}
            value={capDraft}
            onChange={(event) => setCapDraft(event.target.value)}
            onBlur={commitCap}
          />
          <p className="text-xs text-muted-foreground">
            Live voice stops for the day once it has cost this much.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="live-voice-idle-timeout">Idle timeout (seconds)</Label>
          <Input
            id="live-voice-idle-timeout"
            type="number"
            inputMode="numeric"
            min={LIVE_VOICE_IDLE_TIMEOUT_MIN_SEC}
            max={LIVE_VOICE_IDLE_TIMEOUT_MAX_SEC}
            step={1}
            value={idleDraft}
            onChange={(event) => setIdleDraft(event.target.value)}
            onBlur={commitIdle}
          />
          <p className="text-xs text-muted-foreground">
            After this much silence the session drops to the cheaper standby rate (
            {LIVE_VOICE_IDLE_TIMEOUT_MIN_SEC} to {LIVE_VOICE_IDLE_TIMEOUT_MAX_SEC} seconds).
          </p>
        </div>
      </div>
    </div>
  )
}
