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

function projectHit(terminal: QuickTerminal, project: string): boolean {
  const said = spokenWords(terminal.project ?? '')
  return said !== '' && project !== '' && ` ${said} `.includes(` ${project} `)
}

/**
 * Every terminal the spoken name could mean. `exact`: the whole label must
 * equal the name (typing); `words`: the label contains it as whole words.
 * A project may narrow it: "terminal 1 in smid", "smid terminal 1". With no
 * label hit, a project alone ("the smid terminal") picks its terminals.
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
      if (projectHit(terminal, project) && labelHit(terminal, name, mode)) {
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
  if (hits.size > 0) {
    return [...hits]
  }
  return terminals.filter((terminal) => projectHit(terminal, spoken))
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

function spokenList(items: string[]): string {
  return items.length === 2
    ? `${items[0]} and ${items[1]}`
    : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

const distinct = (items: string[]): boolean =>
  items.every(Boolean) && new Set(items.map(spokenWords)).size === items.length

/**
 * "Three are called Terminal 1: in SMID, Website, and FEATURES-HUB. Which
 * one?" for two to five hits; null when there are more, or when the voice
 * could not tell them apart anyway (then ADAM takes it).
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
  return distinct(described) ? `${count} match: ${spokenList(described)}. Which one?` : null
}
