// Checked-in feature map for the Dobius+ repo, derived from
// docs/stabilization/ARCHITECTURE-MAP.md (§0 component map, §14 layers).
// Paths are repo-root relative; session-workspace-feature-map.test.ts fails
// when one of them stops existing, so the map cannot silently drift.

export type WorkspaceLayer = 'Inherited engine' | 'Dobius+ layer' | 'Mixed' | 'Legacy V1'

export type WorkspaceFeature = {
  component: string
  paths: string[]
  layer: WorkspaceLayer
}

// Why: presence of the execution gate marks a checkout (or worktree) of the Dobius+ repo.
export const DOBIUS_REPO_IDENTITY_PATH = 'dobius/src/main/agents/execution-gate.ts'

export const DOBIUS_FEATURE_MAP: readonly WorkspaceFeature[] = [
  { component: 'Main-process startup', paths: ['dobius/src/main/index.ts'], layer: 'Mixed' },
  {
    component: 'Preload bridge',
    paths: ['dobius/src/preload/index.ts'],
    layer: 'Inherited engine'
  },
  {
    component: 'Renderer shell and page routing',
    paths: ['dobius/src/renderer/src/main.tsx', 'dobius/src/renderer/src/App.tsx'],
    layer: 'Mixed'
  },
  {
    component: 'IPC handlers',
    paths: ['dobius/src/main/ipc/', 'dobius/src/main/ipc/register-core-handlers.ts'],
    layer: 'Mixed'
  },
  {
    component: 'Runtime service and RPC',
    paths: ['dobius/src/main/runtime/dobius-runtime.ts', 'dobius/src/main/runtime/runtime-rpc.ts'],
    layer: 'Inherited engine'
  },
  { component: 'Terminal daemon', paths: ['dobius/src/main/daemon/'], layer: 'Inherited engine' },
  {
    component: 'Persistence store',
    paths: ['dobius/src/main/persistence.ts'],
    layer: 'Inherited engine'
  },
  {
    component: 'Agent runs, hard rails, Pause crew gate',
    paths: [
      'dobius/src/main/agents/agent-runner.ts',
      'dobius/src/main/agents/agent-hard-rails.ts',
      'dobius/src/main/agents/execution-gate.ts'
    ],
    layer: 'Dobius+ layer'
  },
  {
    component: 'mcp__dobius__* tool server',
    paths: ['dobius/src/main/agents/agent-tools/'],
    layer: 'Dobius+ layer'
  },
  {
    component: 'Heartbeats and Asana Auto Mode',
    paths: [
      'dobius/src/main/agents/agent-heartbeat-service.ts',
      'dobius/src/main/agents/asana-auto-mode-service.ts',
      'dobius/src/main/asana/'
    ],
    layer: 'Dobius+ layer'
  },
  {
    component: 'Orchestration coordinator',
    paths: ['dobius/src/main/runtime/orchestration/'],
    layer: 'Inherited engine'
  },
  { component: 'Automations', paths: ['dobius/src/main/automations/'], layer: 'Inherited engine' },
  {
    component: 'Kanban auto-dispatch',
    paths: ['dobius/src/renderer/src/components/kanban/'],
    layer: 'Dobius+ layer'
  },
  {
    component: 'Jarvis and Voice Conductor',
    paths: ['dobius/src/main/jarvis/', 'dobius/src/main/voice-conductor/'],
    layer: 'Dobius+ layer'
  },
  {
    component: 'Dictation / speech-to-text',
    paths: ['dobius/src/main/speech/'],
    layer: 'Inherited engine'
  },
  {
    component: 'iMessage bridge',
    paths: ['dobius/src/main/imessage-bridge/'],
    layer: 'Dobius+ layer'
  },
  {
    component: 'Communications (Buzz relay and client)',
    paths: ['dobius/src/main/communications/'],
    layer: 'Dobius+ layer'
  },
  {
    component: 'Localhost dispatch server and dobius-* CLIs',
    paths: ['dobius/src/main/dobius-cli/'],
    layer: 'Dobius+ layer'
  },
  {
    component: 'Agent hook server',
    paths: ['dobius/src/main/agent-hooks/'],
    layer: 'Inherited engine'
  },
  {
    component: 'ADAM link (run-event journal)',
    paths: [
      'dobius/src/main/agents/agent-run-event-journal.ts',
      'dobius/src/main/jarvis/adam-client.ts'
    ],
    layer: 'Dobius+ layer'
  },
  {
    component: 'dobius CLI and SSH relay',
    paths: ['dobius/src/cli/', 'dobius/src/relay/'],
    layer: 'Inherited engine'
  },
  { component: 'Shared types and logic', paths: ['dobius/src/shared/'], layer: 'Inherited engine' },
  {
    component: 'Legacy V1 app (do not build or extend)',
    paths: ['electron/', 'src/'],
    layer: 'Legacy V1'
  }
]

// From the repo's CLAUDE.md "Commands" section; run from `dobius/`.
export const DOBIUS_COMMANDS: readonly string[] = [
  'pnpm run typecheck  # must exit 0; bare npx tsgo --noEmit does not work here',
  'npx vitest run --config config/vitest.config.ts <files or dirs>  # targeted tests',
  'npx oxlint <files>  # lint the files you changed',
  'pnpm run build  # full compile'
]

export const DOBIUS_OFF_LIMITS: readonly string[] = [
  'Use pnpm, never npm. Never run `pnpm test` in a worktree whose node_modules is shared (it rebuilds native modules).',
  "Never hand-edit or reset Carson's live data in `~/Library/Application Support/dobius-plus/`.",
  'Install into `/Applications/Dobius+.app` only through `scripts/install-dobius-gated.sh`; never copy, move or delete the app by hand.',
  'Never kill the app by bundle path: the terminal daemon runs from inside the bundle.',
  'Never read or print secret files (`*token*`, `.env*`, `auth.json`, credentials).',
  'Push or open a PR only when Carson asks.'
]
