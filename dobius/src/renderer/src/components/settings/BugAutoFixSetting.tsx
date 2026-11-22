import type { GlobalSettings } from '../../../../shared/types'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'

const TITLE = 'Fix reported bugs automatically'
const DESCRIPTION =
  'When you report a bug on the Kanban, one fixing agent starts in its own workspace. It checks its fix with typecheck and tests and commits on its own branch for you to review. It never installs or pushes. At most 2 run at once, one per bug, and none start while the crew is paused. On by default. Each fix uses your agent plan; there is no dollar cap per fix.'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BugAutoFixSetting({ settings, updateSettings }: Props): React.JSX.Element {
  // Why !== false: absent means on (Carson's default).
  const enabled = settings.bugAutoFixEnabled !== false

  return (
    <section className="space-y-3">
      <SearchableSetting
        title={TITLE}
        description={DESCRIPTION}
        keywords={[
          'bug',
          'report',
          'fix',
          'auto',
          'kanban',
          'board',
          'agent',
          'worktree'
        ]}
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
            onClick={() => updateSettings({ bugAutoFixEnabled: !enabled })}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
              enabled
                ? 'bg-foreground'
                : 'bg-muted-foreground/30 ring-1 ring-inset ring-muted-foreground/70'
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
