// Pure text for forward (hand finished replies to another console) and handoff
// (ask one console for a takeover brief). One-line-safe output is not required:
// the delivery gate pastes multi-line text as a single message.
import { translate } from '@/i18n/i18n'

export type ForwardReply = { name: string; text: string }

function section(reply: ForwardReply, index: number): string {
  return `## ${index + 1}. ${reply.name}\n\n${reply.text.trim()}`
}

/** Everything the sources replied, in order, framed so the receiver acts on all of it. */
export function forwardDigest(
  question: string,
  replies: readonly ForwardReply[],
  ask: string
): string {
  return [
    translate(
      'board.forward.preface',
      'Results from other agents are below. Act on all of them: {{ask}}',
      { ask: ask.trim() }
    ),
    translate('board.forward.question', 'They were asked: {{question}}', {
      question: question.trim()
    }),
    ...replies.map(section),
    translate('board.forward.closing', 'End of forwarded results.')
  ].join('\n\n')
}

/**
 * Split mode: whole replies dealt into at most `laneCount` balanced parts (by
 * length, greedy), never more parts than replies. Each part says who holds the rest.
 */
export function splitForward(
  question: string,
  replies: readonly ForwardReply[],
  ask: string,
  laneNames: readonly string[]
): string[] {
  const parts = Math.min(laneNames.length, replies.length)
  if (parts <= 1) {
    return parts === 0 ? [] : [forwardDigest(question, replies, ask)]
  }
  const buckets: { replies: ForwardReply[]; size: number }[] = Array.from(
    { length: parts },
    () => ({
      replies: [],
      size: 0
    })
  )
  const bySize = replies
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.text.length - a.r.text.length || a.i - b.i)
  for (const { r } of bySize) {
    const lightest = buckets.reduce((min, b) => (b.size < min.size ? b : min))
    lightest.replies.push(r)
    lightest.size += r.text.length
  }
  // Keep the sources' original order inside each part.
  const order = new Map(replies.map((r, i) => [r, i]))
  return buckets.map((bucket, i) => {
    bucket.replies.sort((a, b) => order.get(a)! - order.get(b)!)
    const others = laneNames.filter((_, j) => j !== i && j < parts)
    const yourPart = translate(
      'board.forward.yourPart',
      'This is your part of the work; {{others}} have the rest.',
      { others: others.join(', ') }
    )
    return `${yourPart}\n\n${forwardDigest(question, bucket.replies, ask)}`
  })
}

export const HANDOFF_START = 'HANDOFF-BRIEF-START'
export const HANDOFF_END = 'HANDOFF-BRIEF-END'

/** What the source console is asked for before another agent takes over. */
export function handoffSummaryRequest(): string {
  return translate(
    'board.handoff.request',
    'Another coding agent is about to take over your current task. Stop working and write a compact brief for it: the goal, what is done, what is left, files touched, and anything risky. Put the brief between a line {{start}} and a line {{end}}, and nothing else after it.',
    { start: HANDOFF_START, end: HANDOFF_END }
  )
}

/** The brief between the markers, else the whole reply; null when empty. */
export function extractHandoffBrief(reply: string | null): string | null {
  if (!reply?.trim()) {
    return null
  }
  const start = reply.lastIndexOf(HANDOFF_START)
  const end = reply.lastIndexOf(HANDOFF_END)
  const inner = start !== -1 && end > start ? reply.slice(start + HANDOFF_START.length, end) : reply
  return inner.trim() || null
}

export function handoffBriefMessage(sourceName: string, brief: string): string {
  return translate(
    'board.handoff.brief',
    'You are taking over a task from {{name}}. Their brief is below. Continue the work from where they stopped.\n\n{{brief}}',
    { name: sourceName, brief }
  )
}

/** True once any pane of `tabId` has reported an agent status (its CLI is up). */
export function tabHasAgentStatus(
  statusByPaneKey: Readonly<Record<string, unknown>>,
  tabId: string
): boolean {
  const prefix = `${tabId}:`
  return Object.keys(statusByPaneKey).some((key) => key.startsWith(prefix))
}
