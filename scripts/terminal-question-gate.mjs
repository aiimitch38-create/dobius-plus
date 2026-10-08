export function proceduralQuestionGate({ vaultHits = 0, relevantHits = 0, question }) {
  if (typeof question !== 'string' || !question.trim()) throw new Error('question is required')
  if (!Number.isInteger(vaultHits) || !Number.isInteger(relevantHits) || vaultHits < 0 || relevantHits < 0) {
    throw new Error('search counts are required')
  }
  return { allowed: vaultHits > 0 && relevantHits > 0, question, searched: { vaultHits, relevantHits },
    reason: vaultHits > 0 && relevantHits > 0 ? 'search evidence attached' : 'search vault and relevant skill/handoff first' }
}

