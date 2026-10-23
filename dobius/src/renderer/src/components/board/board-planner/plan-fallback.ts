import type { BoardPlan, PlanStep } from './plan-schema'
import { agentKindFor } from './plan-target'

// Built-in keyword parser used when the planner is unreachable, rate limited,
// out of credits or busy. It covers simple board commands only: it cannot write
// or split instructions, so work orders get a plain "say who and what" reply.

type Rule = { re: RegExp; step: (m: RegExpMatchArray) => PlanStep | null }

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  un: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  ein: 1,
  zwei: 2,
  drei: 3,
  vier: 4
}

const num = (v: string | undefined): number =>
  v ? Number(v) || WORD_NUMBERS[v.toLowerCase()] || 1 : 1

const RULES: Rule[] = [
  {
    re: new RegExp(
      `^(?:spawn|start|launch|lanza|lance|starte)\\s+(?:(\\d+|${Object.keys(WORD_NUMBERS).join('|')})\\s+)?(.+?)(?:\\s+(?:consoles?|agents?|terminals?|consolas?|agentes?))?$`,
      'i'
    ),
    step: (m) => {
      const cli = agentKindFor(m[2] ?? '')
      return cli
        ? {
            kind: 'spawn',
            // Why: the parser cannot write instructions, and a brief typed by the launch path
            // lands in a bare shell if the agent fails to start. Spawn empty.
            brief: '',
            count: Math.min(12, num(m[1])),
            role: null,
            cli,
            group: null
          }
        : null
    }
  },
  {
    re: /^(pause|pausa|pause tout|pausiere)\s+(all|everyone|todos|tout|alle)$/i,
    step: () => ({ kind: 'pause', target: 'all' })
  },
  {
    re: /^(resume|continue|reanuda|reprends|fortsetzen)\s+(all|everyone|todos|tout|alle)$/i,
    step: () => ({ kind: 'resume', target: 'all' })
  },
  {
    re: /^(fit|show)\s+(the\s+)?(whole\s+)?(board|everything|view)$/i,
    step: () => ({ kind: 'fit_view', target: null })
  },
  { re: /^zoom\s+in$/i, step: () => ({ kind: 'zoom_in' }) },
  { re: /^zoom\s+out$/i, step: () => ({ kind: 'zoom_out' }) },
  { re: /^(reset zoom|zoom 100%?|actual size)$/i, step: () => ({ kind: 'zoom_reset' }) },
  { re: /^(clean|clear)\s+(the\s+)?board$/i, step: () => ({ kind: 'clean_board' }) },
  { re: /^(undo|deshacer|annuler|rückgängig)$/i, step: () => ({ kind: 'undo' }) },
  { re: /^(redo|rehacer|rétablir|wiederholen)$/i, step: () => ({ kind: 'redo' }) },
  {
    re: /^(close|cierra|ferme)\s+(that|this|the panel|eso|ça)$/i,
    step: () => ({ kind: 'close_panel' })
  },
  {
    re: /^(who finished|what happened|report|informe|rapport)\??$/i,
    step: () => ({ kind: 'report' })
  },
  {
    re: /^(status|how is it going|how's it going|estado|statut)\??$/i,
    step: () => ({ kind: 'status' })
  },
  {
    re: /^(cancel|cancela|annule)(\s+that|\s+the last order)?$/i,
    step: () => ({ kind: 'cancel' })
  },
  {
    re: /^(?:open|show|abre|ouvre)\s+(?:the\s+)?(docs|code|markdown|skills|loops|memory|mission map|presets|chat|settings|github|usage)$/i,
    step: (m) => ({
      kind: 'open_studio',
      target: m[1].toLowerCase() as Extract<PlanStep, { kind: 'open_studio' }>['target']
    })
  },
  {
    re: /^(?:dark|light|system)\s+(?:mode|theme)$/i,
    step: (m) => ({
      kind: 'set_theme',
      target: m[0].split(/\s+/)[0].toLowerCase() as 'dark' | 'light' | 'system'
    })
  },
  { re: /^(?:i want to draw|draw|pen)$/i, step: () => ({ kind: 'pick_tool', target: 'pen' }) }
]

export type FallbackResult = { kind: 'plan'; plan: BoardPlan } | { kind: 'work-order' }

export function fallbackParse(utterance: string): FallbackResult {
  const text = utterance.trim().replace(/[.!]+$/, '')
  for (const rule of RULES) {
    const m = text.match(rule.re)
    const step = m ? rule.step(m) : null
    if (step) {
      return {
        kind: 'plan',
        plan: { intent: 'fallback', steps: [step], say: '', detail: null, unsafe: false }
      }
    }
  }
  return { kind: 'work-order' }
}

/**
 * Keeps the built-in parser in charge for a while after repeated planner
 * failures, so a down planner is not retried on every utterance.
 */
export class PlannerBreaker {
  private failures = 0
  private openUntil = 0

  constructor(
    private readonly threshold = 2,
    private readonly coolDownMs = 60_000
  ) {}

  isOpen(now: number): boolean {
    return now < this.openUntil
  }

  recordFailure(now: number): void {
    this.failures += 1
    if (this.failures >= this.threshold) {
      this.openUntil = now + this.coolDownMs
      this.failures = 0
    }
  }

  recordSuccess(): void {
    this.failures = 0
    this.openUntil = 0
  }
}
