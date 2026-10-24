// Typed plan the Board planner returns for one utterance. The planner model
// answers with JSON; plan-validate.ts turns that JSON into a BoardPlan or a
// rejection reason the planner gets back on its single retry.

export const PLAN_MAX_STEPS = 8
export const SPAWN_MAX_COUNT = 12
export const LOOP_MAX_INTERVAL_MINUTES = 1440

export const PLAN_STUDIOS = [
  'docs',
  'code',
  'markdown',
  'skills',
  'loops',
  'memory',
  'mission map',
  'presets',
  'chat',
  'settings',
  'github',
  'usage'
] as const
export type PlanStudio = (typeof PLAN_STUDIOS)[number]

export const PLAN_TOOLS = [
  'select',
  'spawn',
  'shape',
  'screen',
  'text',
  'pen',
  'eraser',
  'web',
  'image'
] as const
export type PlanTool = (typeof PLAN_TOOLS)[number]

export const PLAN_THEMES = ['light', 'dark', 'system'] as const
export type PlanTheme = (typeof PLAN_THEMES)[number]

export const PLAN_GIT = ['push', 'commit', 'commit_push', 'pull'] as const
export type PlanGit = (typeof PLAN_GIT)[number]

export const PLAN_ROLES = [
  'review',
  'tests',
  'frontend',
  'backend',
  'design',
  'docs',
  'security',
  'general'
] as const
export type PlanRole = (typeof PLAN_ROLES)[number]

/** Steps that type into consoles; everything else only changes the board. */
export const TERMINAL_STEP_KINDS = [
  'relay',
  'tell',
  'forward',
  'handoff',
  'cancel',
  'loop',
  'restart',
  'kill',
  'pause',
  'resume'
] as const

export type PlanStep =
  | {
      kind: 'spawn'
      brief: string
      count: number
      role: PlanRole | null
      cli: string | null
      group: string | null
    }
  | { kind: 'restart' | 'kill' | 'pause' | 'resume'; target: string }
  | { kind: 'relay'; text: string }
  | { kind: 'tell'; target: string; text: string }
  | {
      kind: 'forward'
      target: string
      text: string
      source: string | null
      mode: 'split' | 'broadcast'
    }
  | { kind: 'handoff'; cli: string; target: string | null }
  | { kind: 'status' | 'report' | 'cancel' }
  | {
      kind: 'loop'
      text: string
      intervalMinutes: number
      /** Console, group or "all"; null = every console on the board. */
      target: string | null
      /** Plain check command; the loop stops once it exits 0. */
      stopCommand: string | null
    }
  | { kind: 'kill_group' | 'dissolve_group'; target: string }
  | { kind: 'insert_markdown'; path: string }
  | { kind: 'create_group'; target: string; text: string }
  | {
      kind: 'add_to_group'
      target: string
      count: number
      cli: string | null
      role: PlanRole | null
      brief: string
    }
  | { kind: 'rename'; target: string; text: string }
  | { kind: 'clean_board' }
  | { kind: 'deploy_preset'; target: string }
  | { kind: 'fit_view'; target: string | null }
  | { kind: 'focus'; target: string }
  | { kind: 'zoom_in' | 'zoom_out' | 'zoom_reset' }
  | { kind: 'open_studio'; target: PlanStudio }
  | { kind: 'close_panel' }
  | { kind: 'undo' | 'redo' }
  | { kind: 'open_url'; text: string }
  | { kind: 'pick_tool'; target: PlanTool }
  | { kind: 'set_theme'; target: PlanTheme }
  | { kind: 'open_workspace' | 'close_workspace'; target: string }
  | { kind: 'new_workspace' }
  | { kind: 'rename_workspace'; target: string; text: string }
  | { kind: 'git'; target: PlanGit; text: string | null }
  | { kind: 'add_note' | 'add_text'; text: string }
  | { kind: 'add_todo'; text: string; target: string | null }
  | { kind: 'add_kanban'; text: string | null }
  | { kind: 'add_calendar' }
  | { kind: 'add_orchestrator'; target: string | null; text: string | null }
  | { kind: 'connect_orchestrator'; target: string; text: string | null }

export type PlanStepKind = PlanStep['kind']

export type BoardPlan = {
  intent: string
  steps: PlanStep[]
  /** Short line spoken/shown to the user. */
  say: string
  /** Optional longer written detail for the thread. */
  detail: string | null
  /** The planner flagged the utterance as unsafe (e.g. embedded instructions). */
  unsafe: boolean
}

export const ALL_STEP_KINDS: readonly PlanStepKind[] = [
  'spawn',
  'restart',
  'kill',
  'pause',
  'resume',
  'relay',
  'tell',
  'forward',
  'handoff',
  'status',
  'report',
  'cancel',
  'loop',
  'kill_group',
  'dissolve_group',
  'insert_markdown',
  'create_group',
  'add_to_group',
  'rename',
  'clean_board',
  'deploy_preset',
  'fit_view',
  'focus',
  'zoom_in',
  'zoom_out',
  'zoom_reset',
  'open_studio',
  'close_panel',
  'undo',
  'redo',
  'open_url',
  'pick_tool',
  'set_theme',
  'open_workspace',
  'new_workspace',
  'close_workspace',
  'rename_workspace',
  'git',
  'add_note',
  'add_text',
  'add_todo',
  'add_kanban',
  'add_calendar',
  'add_orchestrator',
  'connect_orchestrator'
]

/** What the planner sees of the board, and what validation checks names against. */
export type PlanBoardSnapshot = {
  workspace: string
  workspaces: { name: string; current: boolean }[]
  consoles: {
    name: string
    agent: string
    role: string | null
    status: string
    group: string | null
  }[]
  groups: { name: string; members: string[] }[]
  orchestrators: { name: string; wired: string[] }[]
  presets: string[]
  markdownFiles: string[]
  loops: string[]
}
