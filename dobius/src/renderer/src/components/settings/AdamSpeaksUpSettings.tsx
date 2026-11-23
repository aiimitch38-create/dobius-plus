import { useEffect, useState } from 'react'
import {
  STALE_REMINDER_MINUTES,
  STALE_WAITING_MINUTES,
  STALE_WORKING_MINUTES,
  clockTimeText,
  normalizeMinutes,
  parseClockTime,
  resolveSpeaksUpSettings,
  type MinutesBound
} from '../../../../shared/adam-speaks-up'
import type { VoiceSettings } from '../../../../shared/speech-types'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

type Props = {
  voiceSettings: VoiceSettings
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
}

const CHOICE_CLASS =
  'rounded-md border border-border px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 aria-checked:border-[var(--board-accent)] aria-checked:bg-[var(--board-accent-tint)]'

type MinutesKey = 'adamStaleWaitingMinutes' | 'adamStaleReminderMinutes' | 'adamStaleWorkingMinutes'

const MINUTE_FIELDS: { key: MinutesKey; id: string; label: string; bound: MinutesBound }[] = [
  {
    key: 'adamStaleWaitingMinutes',
    id: 'adam-stale-waiting',
    label: 'Tell me when an agent has waited on me for (minutes)',
    bound: STALE_WAITING_MINUTES
  },
  {
    key: 'adamStaleReminderMinutes',
    id: 'adam-stale-reminder',
    label: 'Remind me once if still unanswered after (minutes)',
    bound: STALE_REMINDER_MINUTES
  },
  {
    key: 'adamStaleWorkingMinutes',
    id: 'adam-stale-working',
    label: 'Tell me when a job works with no new reply for (minutes)',
    bound: STALE_WORKING_MINUTES
  }
]

function Toggle(props: {
  id: string
  label: string
  on: boolean
  onToggle: () => void
  hint: string
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="flex items-center gap-2">
        <button
          id={props.id}
          type="button"
          role="switch"
          aria-checked={props.on}
          onClick={props.onToggle}
          className={CHOICE_CLASS}
        >
          <span className="font-medium text-foreground">{props.on ? 'On' : 'Off'}</span>
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{props.hint}</p>
    </div>
  )
}

function MinutesField(props: {
  field: (typeof MINUTE_FIELDS)[number]
  value: number
  onCommit: (value: number) => void
}): React.JSX.Element {
  const { field, value } = props
  // Why a draft: committed on blur, so "1" on the way to "15" is never saved.
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const next = normalizeMinutes(Number.parseFloat(draft), { ...field.bound, fallback: value })
    setDraft(String(next))
    if (next !== value) {
      props.onCommit(next)
    }
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.id}>{field.label}</Label>
      <Input
        id={field.id}
        type="number"
        inputMode="numeric"
        min={field.bound.min}
        max={field.bound.max}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
      <p className="text-xs text-muted-foreground">
        {field.bound.min} to {field.bound.max} minutes.
      </p>
    </div>
  )
}

// Why plain literals, not translate(): same convention as LiveVoiceSettingsSection.
export function AdamSpeaksUpSettings({
  voiceSettings,
  onUpdateVoiceSettings
}: Props): React.JSX.Element {
  const resolved = resolveSpeaksUpSettings(voiceSettings)
  const values: Record<MinutesKey, number> = {
    adamStaleWaitingMinutes: resolved.waitingMinutes,
    adamStaleReminderMinutes: resolved.reminderMinutes,
    adamStaleWorkingMinutes: resolved.workingMinutes
  }
  const briefTime = clockTimeText(resolved.morningBriefTime)
  const [timeDraft, setTimeDraft] = useState(briefTime)
  useEffect(() => setTimeDraft(briefTime), [briefTime])
  const commitTime = (): void => {
    const parsed = parseClockTime(timeDraft)
    if (!parsed) {
      setTimeDraft(briefTime)
      return
    }
    if (clockTimeText(parsed) !== briefTime) {
      onUpdateVoiceSettings({ adamMorningBriefTime: clockTimeText(parsed) })
    }
  }
  return (
    <div className="space-y-4 py-2">
      <Toggle
        id="adam-can-tap-shoulder"
        label="ADAM can tap me on the shoulder"
        on={resolved.tapOnShoulder}
        onToggle={() => onUpdateVoiceSettings({ adamCanTapShoulder: !resolved.tapOnShoulder })}
        hint="ADAM may tell you on his own when something needs you: out loud on a live call, else a Mac notification. At most 4 an hour."
      />
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Stale alerts for work ADAM sent out (needs &ldquo;ADAM reports finished work&rdquo; on).
          Each is said once.
        </p>
        {MINUTE_FIELDS.map((field) => (
          <MinutesField
            key={field.key}
            field={field}
            value={values[field.key]}
            onCommit={(value) => onUpdateVoiceSettings({ [field.key]: value })}
          />
        ))}
      </div>
      <Toggle
        id="adam-morning-brief"
        label="Morning brief"
        on={resolved.morningBrief}
        onToggle={() => onUpdateVoiceSettings({ adamMorningBrief: !resolved.morningBrief })}
        hint="Every day ADAM texts your phone a short brief (needs the iMessage bridge on), and posts it in his thread with a Mac notification. If the Mac was asleep, it comes on wake within 4 hours."
      />
      <div className="space-y-1.5">
        <Label htmlFor="adam-morning-brief-time">Morning brief time</Label>
        <Input
          id="adam-morning-brief-time"
          type="time"
          value={timeDraft}
          onChange={(event) => setTimeDraft(event.target.value)}
          onBlur={commitTime}
        />
      </div>
    </div>
  )
}
