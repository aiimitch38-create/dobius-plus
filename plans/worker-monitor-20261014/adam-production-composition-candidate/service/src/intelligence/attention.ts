export type AttentionSignal = {
  id: string
  summary: string
  urgency: number
  importance: number
  confidence: number
  reversibility: number
  userInterruptibility: number
}

export type ScoredAttentionSignal = AttentionSignal & { score: number; shouldInterrupt: boolean }

export function scoreAttention(signal: AttentionSignal, threshold = 0.72): ScoredAttentionSignal {
  const score =
    signal.urgency * 0.3 +
    signal.importance * 0.3 +
    signal.confidence * 0.2 +
    (1 - signal.reversibility) * 0.1 +
    signal.userInterruptibility * 0.1
  return { ...signal, score, shouldInterrupt: score >= threshold }
}

