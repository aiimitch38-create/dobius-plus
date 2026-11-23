// Which terminal a spoken name means, for the quick hands. Why its own rules:
// Carson's terminals repeat names ("Terminal 1" in many projects), carry
// spinner glyphs ("⠦ SMID") or have no title at all, so a name is matched on
// its words, may be narrowed by a project ("Terminal 1 in SMID"), and several
// hits get a spoken question instead of a guess.

export type QuickTerminal = {
  handle: string
  /** What the voice calls it. */
  name: string
  /** Every name it answers to (tab rename, pane title); defaults to `name`. */
  labels?: string[]
  /** The project folder it runs in, for "Terminal 1 in SMID". */
  project?: string
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty'
]

/** Lowercase words, punctuation as spaces, "one".."twenty" as digits: "Terminal one" = "terminal 1". */
export function spokenWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .map((word) => {
      const at = NUMBER_WORDS.indexOf(word)
      return at >= 0 ? String(at) : word
    })
    .join(' ')
}

/** A title without the spinner or status glyphs in front ("⠦ SMID" -> "SMID"). */
export function cleanTitle(title: string | null | undefined): string {
  return (title ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

/** A branch as a name: no "refs/heads/", no "owner/" in front. */
export function branchLabel(branch: string | null | undefined): string {
  const bare = (branch ?? '').trim().replace(/^refs\/heads\//, '')
  const slash = bare.indexOf('/')
  return slash > 0 && slash < bare.length - 1 ? bare.slice(slash + 1) : bare
}

type Mode = 'exact' | 'words'

function labelHit(terminal: QuickTerminal, name: string, mode: Mode): boolean {
  return (terminal.labels ?? [terminal.name]).some((label) => {
    const said = spokenWords(label)
    return said !== '' && (mode === 'exact' ? said === name : ` ${said} `.includes(` ${name} `))
  })
}

/**
 * Whether the spoken project names this terminal's project folder: its whole
 * name ("features hub" for FEATURES-HUB) or its first words ("epoxy" for
 * epoxy-site). Never part of a word, never words from the middle.
 */
function inProject(terminal: QuickTerminal, said: string): boolean {
  const project = spokenWords(terminal.project ?? '')
  return project !== '' && said !== '' && (project === said || project.startsWith(`${said} `))
}

/**
 * Every terminal the spoken name could mean. `exact`: the whole label must
 * equal the name (typing); `words`: the label contains it as whole words.
 * A project only narrows a label match: "terminal 1 in smid", "smid
 * terminal 1". Only for reading (`words`) may a project alone ("the smid
 * terminal") pick its terminals; typing always needs the label.
 */
export function matchTerminals(
  terminals: QuickTerminal[],
  target: string,
  mode: Mode
): QuickTerminal[] {
  const spoken = spokenWords(target)
  if (!spoken) {
    return []
  }
  const hits = new Set(terminals.filter((terminal) => labelHit(terminal, spoken, mode)))
  const narrowed = (name: string, project: string): void => {
    for (const terminal of terminals) {
      if (inProject(terminal, project) && labelHit(terminal, name, mode)) {
        hits.add(terminal)
      }
    }
  }
  const parts = spoken.split(' in ')
  for (let i = 1; i < parts.length; i += 1) {
    narrowed(parts.slice(0, i).join(' in '), parts.slice(i).join(' in '))
  }
  const words = spoken.split(' ')
  for (let i = 1; i < words.length; i += 1) {
    narrowed(words.slice(i).join(' '), words.slice(0, i).join(' '))
  }
  if (hits.size > 0 || mode === 'exact') {
    return [...hits]
  }
  return terminals.filter((terminal) => inProject(terminal, spoken))
}

/** The one terminal the name means; null for none or several. */
export function findTerminal(
  terminals: QuickTerminal[],
  target: string,
  exact = false
): QuickTerminal | null {
  const hits = matchTerminals(terminals, target, exact ? 'exact' : 'words')
  return hits.length === 1 ? hits[0] : null
}

const COUNTS = ['', '', 'Two', 'Three', 'Four', 'Five']
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth']

function spokenList(items: string[], joiner = 'and'): string {
  return items.length === 2
    ? `${items[0]} ${joiner} ${items[1]}`
    : `${items.slice(0, -1).join(', ')}, ${joiner} ${items.at(-1)}`
}

const distinct = (items: string[]): boolean =>
  items.every(Boolean) && new Set(items.map(spokenWords)).size === items.length

/**
 * A spoken question for two to five hits, null for any other count:
 * "Three are called Terminal 1: in SMID, Website, and FEATURES-HUB. Which
 * one?", "Two match: Backend left and Backend right. Which one?", or, when
 * not even the project tells them apart, the order they are in.
 */
export function whichOneQuestion(hits: QuickTerminal[]): string | null {
  const count = COUNTS[hits.length]
  if (!count) {
    return null
  }
  const names = hits.map((terminal) => terminal.name)
  const projects = hits.map((terminal) => terminal.project ?? '')
  if (new Set(names.map(spokenWords)).size === 1 && distinct(projects)) {
    return `${count} are called ${names[0]}: in ${spokenList(projects)}. Which one?`
  }
  const described = distinct(projects)
    ? hits.map((terminal) => `${terminal.name} in ${terminal.project}`)
    : names
  if (distinct(described)) {
    return `${count} match: ${spokenList(described)}. Which one?`
  }
  const ordinals = hits.map((_, at) => `the ${ORDINALS[at]}`)
  return `${count} match ${names[0]}, and I can't tell them apart by name. Say ${spokenList(ordinals, 'or')}.`
}

const ORDINAL_REPLY =
  /^(?:the\s+)?(?:(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)(?:\s+one)?|(?:number|option)\s+([1-5]|one|two|three|four|five))$/

/**
 * The one candidate a short answer to "which one?" picks: "the second one",
 * "the SMID one", "Terminal 1 in Website". Null when it picks none or several.
 */
export function pickCandidate(reply: string, candidates: QuickTerminal[]): QuickTerminal | null {
  const said = reply
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!said || said.split(' ').length > 8) {
    return null
  }
  const ordinal = ORDINAL_REPLY.exec(said)
  if (ordinal) {
    const word = ordinal[1] ?? ordinal[2]
    const at = ORDINALS.findIndex((name, i) => word === name || word.startsWith(String(i + 1)))
    const spoken = ['one', 'two', 'three', 'four', 'five'].indexOf(word)
    return candidates[at >= 0 ? at : spoken] ?? null
  }
  const bare = said.replace(/^(?:the|in the|in|on the|on)\s+/, '')
  for (const target of [bare, bare.replace(/\s+one$/, '')]) {
    const hits = matchTerminals(candidates, target, 'words')
    if (hits.length === 1) {
      return hits[0]
    }
  }
  return null
}
