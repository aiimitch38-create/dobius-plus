export type AlgorithmVerdict = 'KEEP' | 'KILL' | 'SIMPLIFY' | 'QUESTION'

export type AlgorithmReview = {
  stepOrder: [1, 2, 3, 4, 5]
  ledger: Array<{
    requirement: string
    owner: string
    verdict: AlgorithmVerdict
    observableImpact: string
  }>
  deletions: Array<{ item: string; savings: string }>
  simplifications: Array<{ item: string; mechanism: string }>
  cycleTime: { loop: string; currentSeconds: number; proposedSeconds: number; method: string }
  automations: Array<{
    candidate: string
    evidencedRepetitions: number
    successCondition: string
    ready: boolean
  }>
}

export type CandidatePlan = {
  id: string
  summary: string
  cost: number
  risk: number
  reversibility: number
  confidence: number
  policyFit: number
  algorithm: AlgorithmReview
}

export type RankedPlan = CandidatePlan & { score: number; rationale: string; algorithmPassed: boolean }

export function validateAlgorithmReview(review: AlgorithmReview): string[] {
  const failures: string[] = []
  if (review.stepOrder.join(',') !== '1,2,3,4,5') failures.push('algorithm steps must run in order 1-5')
  if (review.ledger.length === 0) failures.push('algorithm ledger is empty')
  if (review.ledger.some((item) => !item.owner.trim() || !item.observableImpact.trim())) {
    failures.push('every requirement needs an owner and observable impact')
  }
  if (review.ledger.some((item) => item.verdict === 'QUESTION')) failures.push('unresolved questioned requirement')
  if (!review.cycleTime.loop.trim() || !review.cycleTime.method.trim()) failures.push('cycle-time loop is incomplete')
  if (review.cycleTime.proposedSeconds > review.cycleTime.currentSeconds) {
    failures.push('proposed cycle time cannot be slower than current cycle time')
  }
  for (const automation of review.automations) {
    if (automation.ready && automation.evidencedRepetitions < 3) {
      failures.push(`automation ${automation.candidate} has fewer than three evidenced repetitions`)
    }
    if (automation.ready && !automation.successCondition.trim()) {
      failures.push(`automation ${automation.candidate} lacks a success condition`)
    }
  }
  return failures
}

export function rankPlans(plans: CandidatePlan[]): RankedPlan[] {
  return plans
    .map((plan) => {
      const algorithmFailures = validateAlgorithmReview(plan.algorithm)
      const score =
        plan.confidence * 0.3 +
        plan.reversibility * 0.25 +
        plan.policyFit * 0.25 -
        plan.risk * 0.15 -
        plan.cost * 0.05
      return {
        ...plan,
        score,
        algorithmPassed: algorithmFailures.length === 0,
        rationale: `algorithm=${algorithmFailures.length === 0 ? 'passed' : algorithmFailures.join('; ')}, confidence=${plan.confidence}, reversibility=${plan.reversibility}, policyFit=${plan.policyFit}, risk=${plan.risk}, cost=${plan.cost}`
      }
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
}

export function chooseBestSafePlan(plans: CandidatePlan[]): RankedPlan {
  const ranked = rankPlans(plans).filter((plan) => plan.algorithmPassed && plan.policyFit > 0 && plan.risk < 0.8)
  const best = ranked[0]
  if (!best) throw new Error('No safe candidate plan is available')
  return best
}
