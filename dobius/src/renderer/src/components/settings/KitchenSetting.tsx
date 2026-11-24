import type { GlobalSettings } from '../../../../shared/types'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'

const TITLE = 'Kitchen manager'
const DESCRIPTION =
  'Runs the work loop for Kanban cards you send to the kitchen with "Send to kitchen" on the card. It never picks up a card you did not mark. Each card gets one cook: a Claude agent in its own workspace and branch, with pushing, installing and deleting blocked. Each typecheck, test run and commit waits for your click in its console. At most 3 cooks run at once, and none start while this is off or the crew is paused. A cook that runs past its time cap (45 minutes by default), stops, or shows no progress is restarted once; after that it is stopped, its card goes to Blocked and ADAM is told. A finished cook moves its card to Review, never Done. To stop one cook, move its card out of In Progress. Off by default. Each cook uses your agent plan; there is no dollar cap per card.'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function KitchenSetting({ settings, updateSettings }: Props): React.JSX.Element {
  // Why === true: absent means off; it starts agents with no click per card.
  const enabled = settings.kitchenEnabled === true

  return (
    <section className="space-y-3">
      <SearchableSetting
        title={TITLE}
        description={DESCRIPTION}
        keywords={['kitchen', 'cook', 'manager', 'kanban', 'board', 'agent', 'worktree', 'auto']}
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
            onClick={() => updateSettings({ kitchenEnabled: !enabled })}
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
