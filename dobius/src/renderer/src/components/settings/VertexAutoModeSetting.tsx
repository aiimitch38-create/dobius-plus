import type { GlobalSettings } from '../../../../shared/types'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'

const TITLE = 'Run assigned board tasks automatically'
const DESCRIPTION =
  'When a Vertex board task is assigned to an agent and moved to To Do, that agent starts it, posts progress and a screenshot to Communications, and moves the card to Review. It never marks a task Done. Off by default: this starts agent runs, which cost money, without a click.'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function VertexAutoModeSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const enabled = settings.vertexAutoModeEnabled === true

  return (
    <section className="space-y-3">
      <SearchableSetting
        title={TITLE}
        description={DESCRIPTION}
        keywords={['vertex', 'kanban', 'board', 'task', 'auto', 'dispatch', 'agent', 'assign']}
      >
        <div className="flex items-start justify-between gap-4 py-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <Label>{TITLE}</Label>
            <p className="text-xs text-muted-foreground">{DESCRIPTION}</p>
          </div>
          {/* Why a literal <button>: matches AgentAwakeSetting, whose props are
              read straight off the React element tree by tests that never render. */}
          <button
            type="button"
            role="switch"
            aria-label={TITLE}
            aria-checked={enabled}
            onClick={() => updateSettings({ vertexAutoModeEnabled: !enabled })}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
              enabled ? 'bg-foreground' : 'bg-muted-foreground/30'
            } outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`}
          >
            <span
              className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
                enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </SearchableSetting>
    </section>
  )
}
