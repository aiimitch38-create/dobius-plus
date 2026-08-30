import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { VoiceSettings } from '../../../../shared/speech-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { VoiceEngineSection } from './VoiceEngineSection'

type JarvisSettingsSectionProps = {
  voiceSettings: VoiceSettings
  permissionPending: boolean
  onToggleJarvis: () => void
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
}

/**
 * Keeps the quiet-hours inputs inside 0–23.
 *
 * A number input still yields '' when cleared and accepts pasted junk, and an
 * out-of-range hour would silently disable quiet hours rather than error.
 */
function clampHour(raw: string): number {
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    return 0
  }
  return Math.min(23, Math.max(0, parsed))
}

// Why plain literals, not translate(): the localization catalog gate requires
// synced keys per string; this section ships experimental copy without adding
// catalog entries (same convention as the floating-phone components).
export function JarvisSettingsSection({
  voiceSettings,
  permissionPending,
  onToggleJarvis,
  onUpdateVoiceSettings
}: JarvisSettingsSectionProps): React.JSX.Element {
  // Why drafts: an API key typed character by character must not be persisted
  // (and re-read by the speech path) on every keystroke — Save commits it.
  const [keyDraft, setKeyDraft] = useState(voiceSettings.elevenlabsApiKey ?? '')
  const [voiceDraft, setVoiceDraft] = useState(voiceSettings.elevenlabsVoiceId ?? '')
  const [agentDraft, setAgentDraft] = useState(voiceSettings.elevenlabsAgentId ?? '')
  const [testing, setTesting] = useState(false)
  const [shortcutActive, setShortcutActive] = useState<boolean | null>(null)

  // Surfaces a refused ⌘T grab, which otherwise looks identical to "nothing
  // happened" when the shortcut is pressed.
  useEffect(() => {
    let cancelled = false
    void window.api.jarvis
      .status()
      .then((status) => {
        if (!cancelled) {
          setShortcutActive(status.shortcutActive)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [voiceSettings.jarvisEnabled])

  useEffect(() => {
    setKeyDraft(voiceSettings.elevenlabsApiKey ?? '')
    setVoiceDraft(voiceSettings.elevenlabsVoiceId ?? '')
    setAgentDraft(voiceSettings.elevenlabsAgentId ?? '')
  }, [
    voiceSettings.elevenlabsApiKey,
    voiceSettings.elevenlabsVoiceId,
    voiceSettings.elevenlabsAgentId
  ])

  const dirty =
    keyDraft !== (voiceSettings.elevenlabsApiKey ?? '') ||
    voiceDraft !== (voiceSettings.elevenlabsVoiceId ?? '') ||
    agentDraft !== (voiceSettings.elevenlabsAgentId ?? '')

  const saveElevenLabs = (): void => {
    onUpdateVoiceSettings({
      elevenlabsApiKey: keyDraft.trim(),
      elevenlabsVoiceId: voiceDraft.trim(),
      elevenlabsAgentId: agentDraft.trim()
    })
    toast.success(
      keyDraft.trim() ? 'ElevenLabs voice saved' : 'ElevenLabs cleared — using the built-in voice'
    )
  }

  const testElevenLabs = async (): Promise<void> => {
    if (dirty) {
      saveElevenLabs()
    }
    setTesting(true)
    try {
      const outcome = await window.api.jarvis.speak('Jarvis voice check. This is the voice ADAM will reply in.')
      if (outcome.played) {
        toast.success('Spoke the test line')
      } else {
        toast.error(`Could not speak: ${outcome.reason ?? 'unknown error'}`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <Separator />
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>Jarvis voice loop</Label>
          <p className="text-xs text-muted-foreground">
            Speak to ADAM hands-free. Press ⌘T anywhere to start a turn, or click the floating orb.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={voiceSettings.jarvisEnabled === true}
          aria-label="Jarvis voice loop"
          aria-busy={permissionPending}
          disabled={permissionPending}
          onClick={() => void onToggleJarvis()}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
            voiceSettings.jarvisEnabled ? 'bg-foreground' : 'bg-muted-foreground/30'
          } ${permissionPending ? 'cursor-wait opacity-70' : ''}`}
        >
          <span
            className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
              voiceSettings.jarvisEnabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>Wake word (experimental — orb must stay open)</Label>
          <p className="text-xs text-muted-foreground">
            Say “Hey Adam” while the orb is open to start a turn without pressing anything.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={voiceSettings.jarvisWakeWord === true}
          aria-label="Wake word (experimental)"
          disabled={!voiceSettings.jarvisEnabled}
          onClick={() =>
            onUpdateVoiceSettings({ jarvisWakeWord: !(voiceSettings.jarvisWakeWord === true) })
          }
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors ${
            voiceSettings.jarvisWakeWord ? 'bg-foreground' : 'bg-muted-foreground/30'
          } ${!voiceSettings.jarvisEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          <span
            className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
              voiceSettings.jarvisWakeWord ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>Speak up when a job finishes</Label>
          <p className="text-xs text-muted-foreground">
            Adam says one line when a build or test run in a terminal finishes. He stays quiet
            unless the output actually says it finished, waits 30 seconds, and says nothing more
            for 5 minutes afterwards.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={voiceSettings.jarvisProactive === true}
          aria-label="Speak up when a job finishes"
          disabled={!voiceSettings.jarvisEnabled}
          onClick={() =>
            onUpdateVoiceSettings({ jarvisProactive: !(voiceSettings.jarvisProactive === true) })
          }
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors ${
            voiceSettings.jarvisProactive ? 'bg-foreground' : 'bg-muted-foreground/30'
          } ${!voiceSettings.jarvisEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          <span
            className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
              voiceSettings.jarvisProactive ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {voiceSettings.jarvisProactive === true ? (
        <div className="flex items-center justify-between gap-4 py-2 pl-4">
          <div className="space-y-0.5">
            <Label htmlFor="jarvis-quiet-from">Stay quiet between</Label>
            <p className="text-xs text-muted-foreground">
              Hours of the day, 0–23. Wraps past midnight, so 22 to 8 means overnight.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              id="jarvis-quiet-from"
              type="number"
              min={0}
              max={23}
              className="w-16"
              value={voiceSettings.jarvisProactiveQuietFrom ?? 22}
              onChange={(event) =>
                onUpdateVoiceSettings({ jarvisProactiveQuietFrom: clampHour(event.target.value) })
              }
            />
            <span className="text-xs text-muted-foreground">and</span>
            <Input
              id="jarvis-quiet-to"
              type="number"
              min={0}
              max={23}
              className="w-16"
              value={voiceSettings.jarvisProactiveQuietTo ?? 8}
              onChange={(event) =>
                onUpdateVoiceSettings({ jarvisProactiveQuietTo: clampHour(event.target.value) })
              }
            />
          </div>
        </div>
      ) : null}

      <VoiceEngineSection
        voiceSettings={voiceSettings}
        onUpdateVoiceSettings={onUpdateVoiceSettings}
      />

      <div className="space-y-1.5 py-2">
        <Label htmlFor="jarvis-elevenlabs-key">ElevenLabs voice (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Paste an ElevenLabs API key and voice ID for spoken replies. Empty falls back to the
          built-in macOS voice. Keys start with <code>sk_</code>.
        </p>
        <Input
          id="jarvis-elevenlabs-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="ElevenLabs API key"
          value={keyDraft}
          onChange={(event) => setKeyDraft(event.target.value)}
        />
        <Input
          id="jarvis-elevenlabs-voice"
          autoComplete="off"
          spellCheck={false}
          placeholder="Voice ID"
          value={voiceDraft}
          onChange={(event) => setVoiceDraft(event.target.value)}
        />
        <Input
          id="jarvis-elevenlabs-agent"
          autoComplete="off"
          spellCheck={false}
          placeholder="Agent ID (live conversation, e.g. agent_...)"
          value={agentDraft}
          onChange={(event) => setAgentDraft(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          With an agent ID set, ⌘T opens a live conversation you can interrupt, instead of
          one question at a time. Needs a key with the Conversational AI permission.
        </p>
        <div className="flex items-center gap-2 pt-0.5">
          <Button size="sm" onClick={saveElevenLabs} disabled={!dirty}>
            {dirty ? 'Save' : 'Saved'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void testElevenLabs()}
            disabled={testing}
          >
            {testing ? 'Speaking…' : 'Test voice'}
          </Button>
        </div>
        {voiceSettings.jarvisEnabled === true && shortcutActive === false ? (
          <p className="text-xs text-destructive">
            Cmd+T could not be claimed — another app is holding it, so the shortcut will do
            nothing. Click the orb instead, or quit whatever owns Cmd+T and toggle Jarvis off
            and on.
          </p>
        ) : null}
        {voiceSettings.elevenlabsAgentId?.trim() ? (
          <p className="text-xs text-muted-foreground">
            Live mode is on, so the orb stays on screen. Click it to start or end a
            conversation.
          </p>
        ) : null}
      </div>
      <Separator />
    </>
  )
}
