import type { BoardPlan, PlanBoardSnapshot, PlanStep } from './plan-schema'
import { resolveTarget, targetConsoleNames } from './plan-target'

// Safety screen on a validated plan: the app (not the planner) asks the user to
// confirm before any of these reach a terminal or GitHub.

export type SafetyConcern =
  | { kind: 'risky-text'; category: string; text: string }
  | { kind: 'unnamed-consoles'; names: string[] }
  | { kind: 'everyone-but-named'; named: string[] }
  | { kind: 'unsaid-url'; url: string }
  | { kind: 'unsaid-git'; action: string }
  /** Ends consoles or a workspace; confirmed unless the user named both the action and the target. */
  | { kind: 'destructive'; step: DestructiveKind; target: string | null }

const RISKY: { category: string; re: RegExp }[] = [
  { category: 'delete', re: /\b(rm\s+-|rmdir|delete|remove all|wipe|drop (table|database))\b/i },
  {
    category: 'history',
    re: /\b(force[- ]push|push\s+(-f|--force)|reset\s+--hard|rebase|rewrite history|filter-branch)\b/i
  },
  { category: 'publish', re: /\b(publish|deploy|release|upload|npm publish|git push)\b/i },
  { category: 'credentials', re: /\b(password|api[_ -]?key|secret|token|credential|\.env)\b/i },
  { category: 'install', re: /\b(install|brew|pip install|npm i\b|curl\s+[^|]*\|\s*(sh|bash))\b/i },
  { category: 'files', re: /\b(chmod|chown|mv\s|rename (all|every)|move (all|every))\b/i },
  { category: 'admin', re: /\bsudo\b/i },
  {
    category: 'permissions',
    re: /(^|\s)--(yolo|dangerously-skip-permissions|dangerously-bypass-approvals-and-sandbox)\b/i
  }
]

/**
 * Risky categories in text bound for a terminal. With `utterance`, a category
 * the user said themselves is not flagged (the planner only echoed them); pass
 * null for text the user typed straight to a console, which is always flagged.
 */
export function riskyTextConcerns(text: string, utterance: string | null): SafetyConcern[] {
  for (const { category, re } of RISKY) {
    if (re.test(text) && (utterance === null || !re.test(utterance))) {
      return [{ kind: 'risky-text', category, text }]
    }
  }
  return []
}

type DestructiveKind = 'kill' | 'kill_group' | 'restart' | 'clean_board' | 'close_workspace'

// The user's own words must contain one of these verbs for the step to skip confirmation.
const DESTRUCTIVE_VERBS: Record<DestructiveKind, RegExp> = {
  kill: /\b(kill|close|stop|end|shut down|terminate)\b/i,
  kill_group: /\b(kill|close|delete|remove|end)\b/i,
  restart: /\b(restart|relaunch|reboot|start over)\b/i,
  clean_board: /\b(clean|clear|tidy)\b/i,
  close_workspace: /\b(close|delete|remove)\b/i
}

/**
 * Why: these steps end running agents or a workspace and cannot be undone, so
 * the planner's reading is never enough on its own: the user must have said the
 * action and (where there is one) named the target, or the app asks first.
 */
function destructiveConcern(step: PlanStep, utterance: string): SafetyConcern | null {
  if (
    step.kind !== 'kill' &&
    step.kind !== 'kill_group' &&
    step.kind !== 'restart' &&
    step.kind !== 'clean_board' &&
    step.kind !== 'close_workspace'
  ) {
    return null
  }
  const target = 'target' in step ? step.target : null
  const said = utterance.toLowerCase()
  const verbSaid = DESTRUCTIVE_VERBS[step.kind].test(utterance)
  const targetSaid = target === null || said.includes(target.toLowerCase().replace(/^@/, ''))
  return verbSaid && targetSaid ? null : { kind: 'destructive', step: step.kind, target }
}

const URL_RE = /\bhttps?:\/\/[^\s"')]+|\blocalhost:\d+\b/gi

function stepTexts(step: PlanStep): string[] {
  switch (step.kind) {
    case 'tell':
    case 'relay':
    case 'forward':
    case 'loop':
      return [step.text]
    case 'spawn':
    case 'add_to_group':
      return [step.brief]
    case 'open_url':
      return [step.text]
    default:
      return []
  }
}

function reachedConsoles(step: PlanStep, board: PlanBoardSnapshot): string[] {
  if (step.kind === 'relay') {
    return board.consoles.map((c) => c.name)
  }
  if (step.kind === 'tell' || step.kind === 'forward') {
    const target = resolveTarget(step.target, board)
    return target ? targetConsoleNames(target) : []
  }
  return []
}

export function screenPlan(
  plan: BoardPlan,
  utterance: string,
  board: PlanBoardSnapshot
): SafetyConcern[] {
  const said = utterance.toLowerCase()
  const concerns: SafetyConcern[] = []
  for (const step of plan.steps) {
    for (const text of stepTexts(step)) {
      concerns.push(...riskyTextConcerns(text, utterance))
      for (const url of text.match(URL_RE) ?? []) {
        if (!said.includes(url.toLowerCase())) {
          concerns.push({ kind: 'unsaid-url', url })
        }
      }
    }
    const destructive = destructiveConcern(step, utterance)
    if (destructive) {
      concerns.push(destructive)
    }
    if (step.kind === 'git' && !step.target.split('_').every((word) => said.includes(word))) {
      concerns.push({ kind: 'unsaid-git', action: step.target })
    }
  }
  // Consoles reached that the user never named (by name, group, agent or "all").
  const reached = [...new Set(plan.steps.flatMap((s) => reachedConsoles(s, board)))]
  const namedSomething =
    board.consoles.some((c) => said.includes(c.name.toLowerCase())) ||
    board.groups.some((g) => said.includes(g.name.toLowerCase()))
  const saidEveryone = /\b(all|everyone|everybody|every console|todos|tous|alle)\b/.test(said)
  const saidAgent = board.consoles.some((c) => said.includes(c.agent))
  if (reached.length > 0 && !namedSomething && !saidEveryone && !saidAgent) {
    concerns.push({ kind: 'unnamed-consoles', names: reached })
  }
  if (namedSomething && !saidEveryone && plan.steps.some((s) => s.kind === 'relay')) {
    const named = board.consoles
      .filter((c) => said.includes(c.name.toLowerCase()))
      .map((c) => c.name)
    concerns.push({ kind: 'everyone-but-named', named })
  }
  return concerns
}
