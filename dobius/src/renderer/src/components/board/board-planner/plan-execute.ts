import { translate } from '@/i18n/i18n'
import type {
  BoardPlan,
  PlanBoardSnapshot,
  PlanGit,
  PlanRole,
  PlanStep,
  PlanStudio,
  PlanTheme,
  PlanTool
} from './plan-schema'
import { resolveTarget, targetConsoleNames, type ResolvedTarget } from './plan-target'

// Applies a validated plan. Board actions and terminal actions go through an
// injected effects object, so this dispatcher stays pure and testable and each
// step reports what actually happened (never what an agent "will" do).

export type StepResult = { ok: boolean; text: string }

export type PlanEffects = {
  spawn(input: {
    count: number
    cli: string | null
    role: PlanRole | null
    group: string | null
    brief: string
  }): Promise<StepResult>
  addToGroup(
    group: string,
    input: { count: number; cli: string | null; role: PlanRole | null; brief: string }
  ): Promise<StepResult>
  /** Types `text` into each console through the delivery gate. */
  deliver(consoles: string[], text: string): Promise<StepResult>
  forward(input: {
    to: string[]
    text: string
    source: string | null
    mode: 'split' | 'broadcast'
  }): Promise<StepResult>
  handoff(input: { cli: string; source: string | null }): Promise<StepResult>
  lifecycle(kind: 'restart' | 'kill' | 'pause' | 'resume', consoles: string[]): Promise<StepResult>
  cancelLatest(): Promise<StepResult>
  report(kind: 'status' | 'report'): Promise<StepResult>
  loop(input: {
    text: string
    intervalMinutes: number
    /** Resolved target; null = every console on the board. */
    target: ResolvedTarget | null
    stopCommand: string | null
  }): Promise<StepResult>
  groupAction(
    kind: 'kill_group' | 'dissolve_group' | 'create_group',
    group: string,
    members: string[]
  ): Promise<StepResult>
  rename(target: string, name: string): Promise<StepResult>
  cleanBoard(): Promise<StepResult>
  deployPreset(name: string): Promise<StepResult>
  insertMarkdown(path: string): Promise<StepResult>
  camera(
    kind: 'fit_view' | 'focus' | 'zoom_in' | 'zoom_out' | 'zoom_reset',
    consoles: string[] | null
  ): Promise<StepResult>
  openStudio(target: PlanStudio): Promise<StepResult>
  closePanel(): Promise<StepResult>
  history(kind: 'undo' | 'redo'): Promise<StepResult>
  openUrl(url: string): Promise<StepResult>
  pickTool(tool: PlanTool): Promise<StepResult>
  setTheme(theme: PlanTheme): Promise<StepResult>
  workspace(
    kind: 'open' | 'new' | 'close' | 'rename',
    target: string | null,
    text: string | null
  ): Promise<StepResult>
  git(action: PlanGit, message: string | null): Promise<StepResult>
  figure(
    kind: 'note' | 'text' | 'todo' | 'kanban' | 'calendar',
    text: string | null,
    title: string | null
  ): Promise<StepResult>
  orchestrator(
    kind: 'add' | 'connect',
    consoles: string[],
    name: string | null
  ): Promise<StepResult>
}

function names(target: string, board: PlanBoardSnapshot): string[] {
  const t = resolveTarget(target, board)
  return t ? targetConsoleNames(t) : []
}

export async function executeStep(
  step: PlanStep,
  board: PlanBoardSnapshot,
  fx: PlanEffects
): Promise<StepResult> {
  switch (step.kind) {
    case 'spawn':
      return fx.spawn(step)
    case 'add_to_group':
      return fx.addToGroup(step.target, step)
    case 'relay':
      return fx.deliver(
        board.consoles.map((c) => c.name),
        step.text
      )
    case 'tell':
      return fx.deliver(names(step.target, board), step.text)
    case 'forward':
      return fx.forward({
        to: names(step.target, board),
        text: step.text,
        source: step.source,
        mode: step.mode
      })
    case 'handoff':
      return fx.handoff({ cli: step.cli, source: step.target })
    case 'restart':
    case 'kill':
    case 'pause':
    case 'resume':
      return fx.lifecycle(step.kind, names(step.target, board))
    case 'cancel':
      return fx.cancelLatest()
    case 'status':
    case 'report':
      return fx.report(step.kind)
    case 'loop': {
      const target = step.target ? resolveTarget(step.target, board) : null
      // Why: an unresolved name must never widen to "every console".
      if (step.target && !target) {
        return {
          ok: false,
          text: translate(
            'board.plan.loop.noSuchTarget',
            'Nothing on the board is called “{{name}}”, so no loop was made.',
            { name: step.target }
          )
        }
      }
      return fx.loop({
        text: step.text,
        intervalMinutes: step.intervalMinutes,
        target,
        stopCommand: step.stopCommand
      })
    }
    case 'kill_group':
    case 'dissolve_group':
      return fx.groupAction(step.kind, step.target, names(step.target, board))
    case 'create_group':
      return fx.groupAction('create_group', step.text, names(step.target, board))
    case 'rename':
      return fx.rename(step.target, step.text)
    case 'clean_board':
      return fx.cleanBoard()
    case 'deploy_preset':
      return fx.deployPreset(step.target)
    case 'insert_markdown':
      return fx.insertMarkdown(step.path)
    case 'fit_view':
      return fx.camera('fit_view', step.target ? names(step.target, board) : null)
    case 'focus':
      return fx.camera('focus', names(step.target, board))
    case 'zoom_in':
    case 'zoom_out':
    case 'zoom_reset':
      return fx.camera(step.kind, null)
    case 'open_studio':
      return fx.openStudio(step.target)
    case 'close_panel':
      return fx.closePanel()
    case 'undo':
    case 'redo':
      return fx.history(step.kind)
    case 'open_url':
      return fx.openUrl(step.text)
    case 'pick_tool':
      return fx.pickTool(step.target)
    case 'set_theme':
      return fx.setTheme(step.target)
    case 'open_workspace':
      return fx.workspace('open', step.target, null)
    case 'close_workspace':
      return fx.workspace('close', step.target, null)
    case 'new_workspace':
      return fx.workspace('new', null, null)
    case 'rename_workspace':
      return fx.workspace('rename', step.target, step.text)
    case 'git':
      return fx.git(step.target, step.text)
    case 'add_note':
      return fx.figure('note', step.text, null)
    case 'add_text':
      return fx.figure('text', step.text, null)
    case 'add_todo':
      return fx.figure('todo', step.text, step.target)
    case 'add_kanban':
      return fx.figure('kanban', null, step.text)
    case 'add_calendar':
      return fx.figure('calendar', null, null)
    case 'add_orchestrator':
      return fx.orchestrator('add', step.target ? names(step.target, board) : [], step.text)
    case 'connect_orchestrator':
      return fx.orchestrator('connect', names(step.target, board), step.text)
  }
}

/** Runs steps in order; one failed step never stops the rest. */
export async function executePlan(
  plan: BoardPlan,
  board: PlanBoardSnapshot,
  fx: PlanEffects
): Promise<StepResult[]> {
  const results: StepResult[] = []
  for (const step of plan.steps) {
    try {
      results.push(await executeStep(step, board, fx))
    } catch (error) {
      results.push({ ok: false, text: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
