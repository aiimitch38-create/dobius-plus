import {
  ALL_STEP_KINDS,
  LOOP_MAX_INTERVAL_MINUTES,
  PLAN_GIT,
  PLAN_ROLES,
  PLAN_STUDIOS,
  PLAN_THEMES,
  PLAN_TOOLS,
  SPAWN_MAX_COUNT,
  type PlanBoardSnapshot,
  type PlanRole,
  type PlanStep
} from './plan-schema'
import { resolveTarget, splitAddressee } from './plan-target'

// Parses one raw step from the planner's JSON into a typed PlanStep, or returns
// the rejection reason. Field-level checks only; plan-level rules live in
// plan-validate.ts.

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v.toLowerCase())
    ? (v.toLowerCase() as T)
    : null

function needTarget(raw: Raw, board: PlanBoardSnapshot): { target: string } | string {
  const target = str(raw.target)
  if (!target) {
    return `${String(raw.kind)} needs a target`
  }
  return resolveTarget(target, board) ? { target } : `target "${target}" is not on the board`
}

// One function per kind would be cleaner to read but triples the line count;
// grouped by required fields instead.
export function parseStep(raw: unknown, board: PlanBoardSnapshot): PlanStep | string {
  if (!isObj(raw) || typeof raw.kind !== 'string') {
    return 'a step has no kind'
  }
  const kind = raw.kind
  if (!(ALL_STEP_KINDS as readonly string[]).includes(kind)) {
    return `unknown step kind "${kind}"`
  }
  const text = str(raw.text)
  const role: PlanRole | null = oneOf(PLAN_ROLES, raw.role)
  const cli = str(raw.cli)
  switch (kind) {
    case 'spawn':
    case 'add_to_group': {
      const brief = str(raw.brief)
      if (!brief) {
        return `${kind} needs a brief`
      }
      const count = typeof raw.count === 'number' ? Math.round(raw.count) : 1
      if (count < 1 || count > SPAWN_MAX_COUNT) {
        return `${kind} count must be 1-${SPAWN_MAX_COUNT}`
      }
      if (kind === 'spawn') {
        return { kind, brief, count, role, cli, group: str(raw.group) }
      }
      const t = needTarget(raw, board)
      if (typeof t === 'string') {
        return t
      }
      return board.groups.some((g) => g.name.toLowerCase() === t.target.toLowerCase())
        ? { kind, target: t.target, count, cli, role, brief }
        : `add_to_group target "${t.target}" is not a group`
    }
    case 'restart':
    case 'kill':
    case 'pause':
    case 'resume':
    case 'focus':
    case 'kill_group':
    case 'dissolve_group': {
      const t = needTarget(raw, board)
      if (typeof t === 'string') {
        return t
      }
      if (
        (kind === 'kill_group' || kind === 'dissolve_group') &&
        resolveTarget(t.target, board)?.kind !== 'group'
      ) {
        return `${kind} target "${t.target}" is not a group`
      }
      return { kind, target: t.target }
    }
    case 'relay':
      return text ? { kind, text } : 'relay needs text'
    case 'tell': {
      const t = needTarget(raw, board)
      if (typeof t === 'string') {
        return t
      }
      return text ? { kind, target: t.target, text } : 'tell needs text'
    }
    case 'forward': {
      const t = needTarget(raw, board)
      if (typeof t === 'string') {
        return t
      }
      if (!text) {
        return 'forward needs text saying what to do with the results'
      }
      return {
        kind,
        target: t.target,
        text,
        source: str(raw.source),
        mode: raw.mode === 'broadcast' ? 'broadcast' : 'split'
      }
    }
    case 'handoff':
      return cli ? { kind, cli, target: str(raw.target) } : 'handoff needs a cli'
    case 'status':
    case 'report':
    case 'cancel':
    case 'clean_board':
    case 'zoom_in':
    case 'zoom_out':
    case 'zoom_reset':
    case 'close_panel':
    case 'undo':
    case 'redo':
    case 'new_workspace':
    case 'add_calendar':
      return { kind }
    case 'loop': {
      const minutes =
        typeof raw.interval_minutes === 'number' ? raw.interval_minutes : raw.intervalMinutes
      if (!text) {
        return 'loop needs text'
      }
      if (typeof minutes !== 'number' || minutes < 1 || minutes > LOOP_MAX_INTERVAL_MINUTES) {
        return `loop interval_minutes must be 1-${LOOP_MAX_INTERVAL_MINUTES}`
      }
      let target = str(raw.target)
      let instruction = text
      // Why: "tell Claude 1 to run the tests" with no target would otherwise
      // loop on every console with the addressee left inside the message.
      const addressed = target ? null : splitAddressee(text)
      if (addressed) {
        if (!resolveTarget(addressed.target, board)) {
          return `loop text addresses "${addressed.target}", which is not on the board; put the console or group in target`
        }
        target = addressed.target
        instruction = addressed.text
      }
      if (target && !resolveTarget(target, board)) {
        return `target "${target}" is not on the board`
      }
      return {
        kind,
        text: instruction,
        intervalMinutes: Math.round(minutes),
        target,
        stopCommand: str(raw.stop_command) ?? str(raw.stopCommand)
      }
    }
    case 'insert_markdown': {
      const path = str(raw.path)
      return path && board.markdownFiles.includes(path)
        ? { kind, path }
        : `markdown path "${path ?? ''}" is not listed`
    }
    case 'create_group':
    case 'rename': {
      const t = needTarget(raw, board)
      if (typeof t === 'string') {
        return t
      }
      return text ? { kind, target: t.target, text } : `${kind} needs text (the name)`
    }
    case 'deploy_preset': {
      const target = str(raw.target)
      const preset = target && board.presets.find((p) => p.toLowerCase() === target.toLowerCase())
      return preset ? { kind, target: preset } : `preset "${target ?? ''}" is not in the library`
    }
    case 'fit_view': {
      const target = str(raw.target)
      return !target || resolveTarget(target, board)
        ? { kind, target }
        : `target "${target}" is not on the board`
    }
    case 'open_studio': {
      const target = oneOf(PLAN_STUDIOS, raw.target)
      return target ? { kind, target } : `unknown studio "${String(raw.target)}"`
    }
    case 'open_url':
      return text ? { kind, text } : 'open_url needs a URL or port'
    case 'pick_tool': {
      const target = oneOf(PLAN_TOOLS, raw.target)
      return target ? { kind, target } : `unknown tool "${String(raw.target)}"`
    }
    case 'set_theme': {
      const target = oneOf(PLAN_THEMES, raw.target)
      return target ? { kind, target } : `unknown theme "${String(raw.target)}"`
    }
    case 'open_workspace':
    case 'close_workspace':
    case 'rename_workspace': {
      const target = str(raw.target)
      if (!target) {
        return `${kind} needs a target`
      }
      if (kind === 'close_workspace' && board.workspaces.length <= 1) {
        return 'cannot close the only workspace'
      }
      if (kind === 'rename_workspace') {
        return text ? { kind, target, text } : 'rename_workspace needs the new name'
      }
      return { kind, target }
    }
    case 'git': {
      const target = oneOf(PLAN_GIT, raw.target)
      return target ? { kind, target, text } : `unknown git action "${String(raw.target)}"`
    }
    case 'add_note':
    case 'add_text':
      return text ? { kind, text } : `${kind} needs text`
    case 'add_todo':
      return text ? { kind, text, target: str(raw.target) } : 'add_todo needs items'
    case 'add_kanban':
      return { kind, text }
    case 'add_orchestrator':
      return { kind, target: str(raw.target), text }
    case 'connect_orchestrator': {
      const t = needTarget(raw, board)
      if (typeof t === 'string') {
        return t
      }
      if (!text && board.orchestrators.length > 1) {
        return 'several orchestrator cards exist; name which one'
      }
      return { kind, target: t.target, text }
    }
  }
  return `unknown step kind "${kind}"`
}
