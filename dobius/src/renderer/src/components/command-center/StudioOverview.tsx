import { ArrowUpRight, Folder, LayoutDashboard, Plus, StickyNote } from 'lucide-react'
import { Button } from '../ui/button'
import type { StudioData, StudioAction, StudioPanel, StudioRecord } from './studio-state'
import { DataCatalogPanel } from './DataCatalogPanel'

export function StudioOverview({
  surface,
  data,
  openSpace,
  setSurface,
  act,
  add
}: {
  surface: 'command' | 'knowledge'
  data: StudioData
  openSpace: (id: string, panelId?: string) => void
  setSurface: (surface: StudioRecord['kind']) => void
  act: (action: StudioAction) => void
  add: (kind: StudioPanel['kind']) => void
}): React.JSX.Element {
  return surface === 'command' ? (
    <div className="studio-overview scrollbar-sleek">
      <div className="studio-overview-heading">
        <LayoutDashboard className="size-7" />
        <h1>Command Center</h1>
        <p>Your spaces, creative work, and execution tools in one place.</p>
      </div>
      <div className="studio-overview-grid">
        <section>
          <div className="studio-section-title">Continue creating</div>
          {data.spaces.map((space) => (
            <button
              className="studio-overview-row"
              key={space.id}
              onClick={() => {
                openSpace(space.id)
              }}
            >
              <Folder className="size-4" />
              <span>
                {space.name}
                <small>{space.panels.length} canvas objects</small>
              </span>
              <ArrowUpRight className="size-4" />
            </button>
          ))}
        </section>
        <section>
          <div className="studio-section-title">Execution tools</div>
          {(
            ['terminal', 'browser', 'agents', 'automations', 'skills', 'buzz', 'system'] as const
          ).map((action) => (
            <button
              className="studio-overview-row capitalize"
              key={action}
              onClick={() => act(action)}
            >
              {action}
              <ArrowUpRight className="ml-auto size-4" />
            </button>
          ))}
        </section>
        <section>
          <div className="studio-section-title">Drafts in progress</div>
          {data.records.filter((record) => record.status !== 'Done').length ? (
            data.records
              .filter((record) => record.status !== 'Done')
              .map((record) => (
                <button
                  className="studio-overview-row"
                  key={record.id}
                  onClick={() => setSurface(record.kind)}
                >
                  <span>
                    {record.title}
                    <small>
                      {record.kind} · {record.status}
                    </small>
                  </span>
                  <ArrowUpRight className="size-4" />
                </button>
              ))
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              Create a mission, client, or campaign draft to start planning.
            </p>
          )}
        </section>
      </div>
    </div>
  ) : (
    <div className="studio-records scrollbar-sleek">
      <h1 className="text-2xl font-semibold">Knowledge</h1>
      <p className="my-3 text-sm text-muted-foreground">
        Notes saved across your creative Spaces. Obsidian sync is not connected here yet.
      </p>
      <Button size="sm" onClick={() => add('note')}>
        <Plus />
        Create note
      </Button>
      <div className="mt-6 space-y-2">
        {data.spaces.flatMap((space) =>
          space.panels
            .filter((panel) => panel.kind === 'note')
            .map((panel) => (
              <button
                className="studio-overview-row w-full"
                key={panel.id}
                onClick={() => {
                  openSpace(space.id, panel.id)
                }}
              >
                <StickyNote className="size-4" />
                <span>
                  {panel.title}
                  <small>
                    {space.name} · {panel.text.slice(0, 100) || 'Empty note'}
                  </small>
                </span>
                <ArrowUpRight className="size-4" />
              </button>
            ))
        )}
      </div>
      <DataCatalogPanel />
    </div>
  )
}
