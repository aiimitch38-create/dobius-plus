import { useState } from 'react'
import { toast } from 'sonner'
import type {
  LocalTtsEngine,
  TtsBakeoffResult,
  VoiceEngineChoice,
  VoiceSettings
} from '../../../../shared/speech-types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'

type VoiceEngineSectionProps = {
  voiceSettings: VoiceSettings
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
}

function choiceButtonClass(active: boolean): string {
  return `rounded-md border px-2.5 py-1 text-xs transition-colors ${
    active
      ? 'border-foreground bg-foreground text-background'
      : 'border-border bg-transparent text-muted-foreground hover:text-foreground'
  }`
}

/**
 * Which engine speaks, which local voice, and the bake-off runner. Local is
 * the default — the ElevenLabs account is out of credits — so this is the
 * section Carson actually uses day to day.
 */
export function VoiceEngineSection({
  voiceSettings,
  onUpdateVoiceSettings
}: VoiceEngineSectionProps): React.JSX.Element {
  const [bakeoffRunning, setBakeoffRunning] = useState(false)
  const [bakeoffReportPath, setBakeoffReportPath] = useState<string | null>(null)

  const engine: VoiceEngineChoice = voiceSettings.voiceEngine === 'elevenlabs' ? 'elevenlabs' : 'local'
  const localVoice: LocalTtsEngine =
    voiceSettings.localTtsEngine === 'supertonic' ? 'supertonic' : 'kokoro'

  const runBakeoff = async (): Promise<void> => {
    setBakeoffRunning(true)
    try {
      const result: TtsBakeoffResult = await window.api.speech.runBakeoff()
      setBakeoffReportPath(result.reportPath)
      if (result.winner) {
        toast.success(`Bake-off done — ${result.winner} is faster and is now the default`)
      } else {
        toast.error('Bake-off failed on both engines — see the report')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBakeoffRunning(false)
    }
  }

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label>Voice engine</Label>
          <p className="text-xs text-muted-foreground">
            Local speaks on-device for free. ElevenLabs is only used when picked here.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={engine === 'local'}
            className={choiceButtonClass(engine === 'local')}
            onClick={() => onUpdateVoiceSettings({ voiceEngine: 'local' })}
          >
            Local
          </button>
          <button
            type="button"
            aria-pressed={engine === 'elevenlabs'}
            className={choiceButtonClass(engine === 'elevenlabs')}
            onClick={() => onUpdateVoiceSettings({ voiceEngine: 'elevenlabs' })}
          >
            ElevenLabs
          </button>
        </div>
      </div>

      {engine === 'local' ? (
        <div className="flex items-center justify-between gap-4 pl-4">
          <div className="space-y-0.5">
            <Label>Local voice</Label>
            <p className="text-xs text-muted-foreground">
              Kokoro reads better, Supertonic answers faster. The first reply downloads the
              model (~140 MB) once.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-pressed={localVoice === 'kokoro'}
              className={choiceButtonClass(localVoice === 'kokoro')}
              onClick={() => onUpdateVoiceSettings({ localTtsEngine: 'kokoro' })}
            >
              Kokoro
            </button>
            <button
              type="button"
              aria-pressed={localVoice === 'supertonic'}
              className={choiceButtonClass(localVoice === 'supertonic')}
              onClick={() => onUpdateVoiceSettings({ localTtsEngine: 'supertonic' })}
            >
              Supertonic
            </button>
            <Button
              size="sm"
              variant="outline"
              disabled={bakeoffRunning}
              onClick={() => void runBakeoff()}
            >
              {bakeoffRunning ? 'Comparing…' : 'Run bake-off'}
            </Button>
          </div>
        </div>
      ) : null}

      {bakeoffReportPath ? (
        <p className="pl-4 text-xs text-muted-foreground">
          Report and WAV samples: <code>{bakeoffReportPath}</code> — listen before trusting the
          latency winner.
        </p>
      ) : null}
    </div>
  )
}
