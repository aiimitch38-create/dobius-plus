import { actionDigest } from './action-digest.js'
import type { Action, AuthorityConfig, Evaluation, RuntimeMode } from './schema.js'

const READ_ONLY_CATEGORIES = new Set(['read', 'research', 'analyze', 'monitor', 'verify'])

function ruleMatches(
  rule: AuthorityConfig['rules'][number],
  action: Action
): boolean {
  if (!rule.categories.includes(action.category)) {
    return false
  }
  if (!rule.match) {
    return true
  }
  return Object.entries(rule.match).every(
    ([key, expected]) => action[key as keyof Action] === expected
  )
}

export function evaluateAction(
  config: AuthorityConfig,
  action: Action,
  mode: RuntimeMode = 'normal'
): Evaluation {
  const digest = actionDigest(action)
  if (mode === 'frozen') {
    return {
      decision: 'deny',
      ruleId: 'runtime-frozen',
      explanation: 'ADAM is frozen; no new actions are authorized.',
      actionDigest: digest
    }
  }
  if (mode === 'read_only' && !READ_ONLY_CATEGORIES.has(action.category)) {
    return {
      decision: 'deny',
      ruleId: 'runtime-read-only',
      explanation: `Read-only mode denies ${action.category}.`,
      actionDigest: digest
    }
  }

  const rule = config.rules.find((candidate) => ruleMatches(candidate, action))
  if (!rule) {
    return {
      decision: config.defaultDecision,
      ruleId: 'default',
      explanation: `No authority rule matched ${action.category}; default is ${config.defaultDecision}.`,
      actionDigest: digest
    }
  }
  return {
    decision: rule.decision,
    ruleId: rule.id,
    explanation: rule.description,
    actionDigest: digest
  }
}

