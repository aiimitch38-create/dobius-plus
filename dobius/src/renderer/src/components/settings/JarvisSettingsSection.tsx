import type { VoiceSettings } from '../../../../shared/speech-types'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'

type JarvisSettingsSectionProps = {
  voiceSettings: VoiceSettings
  permissionPending: boolean
  onToggleJarvis: () => void
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
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
  return (
    <>
      <Separator />
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>Jarvis voice loop</Label>
          <p className="text-xs text-muted-foreground">
            Speak to ADAM hands-free. Press ⌘T anywhere to talk to ADAM; ⌘E keeps its normal dictation. The voice orb shows what Jarvis is doing.
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
          <Label>Wake word (experimental)</Label>
          <p className="text-xs text-muted-foreground">
            Say “Hey Adam” to start a turn without pressing anything. It steps aside whenever you use ⌘E.
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
      <div className="space-y-2 py-2">
        <Label>ElevenLabs voice (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Paste your API key and a voice ID to give Jarvis a premium voice. Left empty, the built-in
          Mac voice speaks instead. Saved locally, never synced.
        </p>
        <input
          type="password"
          value={voiceSettings.elevenlabsApiKey ?? ''}
          placeholder="ElevenLabs API key"
          autoComplete="off"
          onChange={(event) => onUpdateVoiceSettings({ elevenlabsApiKey: event.target.value.trim() || undefined })}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        />
        <input
          type="text"
          value={voiceSettings.elevenlabsVoiceId ?? ''}
          placeholder="Voice ID (e.g. 21m00Tcm4TlvDq8ikWAM)"
          autoComplete="off"
          onChange={(event) => onUpdateVoiceSettings({ elevenlabsVoiceId: event.target.value.trim() || undefined })}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        />
      </div>
      <Separator />
