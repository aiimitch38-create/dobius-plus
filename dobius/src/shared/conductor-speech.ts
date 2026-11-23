// What ADAM's conductor may say to a model (the live voice, Hermes): fixed
// templates and a name from an allowlist, nothing else. Why so strict: a
// terminal's title and its agent's reply are written by whatever runs there,
// so none of their words may ever reach a model (Carson's call, 2026-11-22).
import { AGENT_NAMES } from './agent-names'

export type ConductorEvent = 'done' | 'unclear' | 'needs-you' | 'started' | 'progress'

/** One update, as it may be spoken: an event and a speakable name. */
export type ConductorSpoken = { event: ConductorEvent; name: string; minutes?: number }

const AGENT_NAME_SET = new Set(AGENT_NAMES)
const NUMBERED = /^(.+) ([2-9]|[1-9][0-9]{1,2})$/
const PROJECT_MAX_CHARS = 30
const GENERIC = 'a terminal'
const IN_PROJECT = /^a terminal in [A-Za-z0-9 ._-]{1,30}$/

/** True for an exact library name, optionally numbered ("Juniper", "Juniper 2"). */
export function isLibraryAgentName(name: string): boolean {
  if (AGENT_NAME_SET.has(name)) {
    return true
  }
  const numbered = NUMBERED.exec(name)
  return numbered !== null && AGENT_NAME_SET.has(numbered[1])
}

/** The project folder name reduced to safe characters, or '' when nothing is left. */
function safeProject(project: string | null | undefined): string {
  return (project ?? '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PROJECT_MAX_CHARS)
    .trim()
}

/**
 * The name a model may hear for a terminal: its agent name only when it is a
 * library name, else "a terminal in <project>", else "a terminal". Never the
 * title.
 */
export function speakableName(
  agentName: string | null | undefined,
  project: string | null | undefined
): string {
  const name = agentName?.trim() ?? ''
  if (name && isLibraryAgentName(name)) {
    return name
  }
  const folder = safeProject(project)
  return folder ? `${GENERIC} in ${folder}` : GENERIC
}

/** True for a name speakableName could have produced. Checked again where it is spoken. */
export function isSpeakableName(name: string): boolean {
  return name === GENERIC || IN_PROJECT.test(name) || isLibraryAgentName(name)
}

const MAX_NAMED = 6

function capitalized(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

// Why a budget: the live call cuts a message at 1,000 characters, so a long
// batch is built to fit (names stop, "and N more" ends it) instead of being cut.
export const CONDUCTOR_SPEECH_MAX_CHARS = 900
const SUFFIX_ROOM = 50

function listOf(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * "A", "A and B", "A, B and C"; past six: "A, B, C, D <verb>, and 3 more <verb>: E, F, G".
 * Never longer than `budget`: names that do not fit become "and N more".
 */
function namesThen(names: string[], verb: string, plural: string, budget: number): string {
  if (names.length <= MAX_NAMED) {
    const line = `${listOf(names)} ${names.length === 1 ? verb : plural}.`
    if (line.length <= budget) {
      return line
    }
  } else {
    const head = names.slice(0, MAX_NAMED - 2)
    const rest = names.slice(MAX_NAMED - 2)
    const line = `${head.join(', ')} ${plural}, and ${rest.length} more ${plural}: ${rest.join(', ')}.`
    if (line.length <= budget) {
      return line
    }
  }
  const shown: string[] = []
  for (const name of names) {
    const next = [...shown, name]
    const line = `${next.join(', ')} ${plural}, and ${names.length - next.length} more.`
    if (next.length >= names.length || next.length > MAX_NAMED || line.length > budget) {
      break
    }
    shown.push(name)
  }
  return shown.length === 0
    ? `${names.length} terminals ${plural}.`
    : `${shown.join(', ')} ${plural}, and ${names.length - shown.length} more.`
}

function minutesText(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/**
 * The sentences for a set of updates, from templates only. Done and needs-you
 * come first; progress lines are left out whenever one of those is present.
 * Names that fail isSpeakableName are said as "a terminal".
 */
export function conductorSentences(updates: ConductorSpoken[]): string[] {
  const safe = updates.map((update) => ({
    ...update,
    name: isSpeakableName(update.name) ? update.name : GENERIC
  }))
  const of = (event: ConductorEvent): string[] => [
    ...new Set(safe.filter((update) => update.event === event).map((update) => update.name))
  ]
  const lines: string[] = []
  const done = of('done')
  const unclear = of('unclear')
  const needs = of('needs-you')
  const groups = [done, unclear, needs].filter((names) => names.length > 0).length || 2
  const budget = Math.floor(CONDUCTOR_SPEECH_MAX_CHARS / groups) - SUFFIX_ROOM
  if (done.length > 0) {
    lines.push(namesThen(done, 'finished', 'finished', budget))
  }
  if (unclear.length > 0) {
    const one = unclear.length === 1
    lines.push(
      namesThen(unclear, 'finished', 'finished', budget).replace(
        /\.$/,
        `, but I could not tell if ${one ? 'it' : 'they'} worked.`
      )
    )
  }
  if (needs.length > 0) {
    lines.push(namesThen(needs, 'needs you', 'need you', budget))
  }
  if (lines.length > 0) {
    return lines.map(capitalized)
  }
  const started = of('started')
  const working = safe.filter((update) => update.event === 'progress')
  if (started.length > 0) {
    lines.push(namesThen(started, 'started working', 'started working', budget))
  }
  const workingNames = [...new Set(working.map((update) => update.name))]
  if (workingNames.length === 1 && typeof working[0]?.minutes === 'number') {
    lines.push(`${workingNames[0]} is still working, ${minutesText(working[0].minutes)} in.`)
  } else if (workingNames.length > 0) {
    lines.push(namesThen(workingNames, 'is still working', 'are still working', budget))
  }
  return lines.map(capitalized)
}

/** All updates as one spoken line. */
export function conductorSpeech(updates: ConductorSpoken[]): string {
  return conductorSentences(updates).join(' ')
}
