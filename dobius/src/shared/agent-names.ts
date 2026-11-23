import { stripLeadingAgentTitleDecorationOrEmpty } from './agent-title-decoration'
import { GENERATED_TAB_TITLE_MAX_LENGTH } from './agent-tab-title'
import { isShellProcess } from './shell-process-detection'

// Why: "Terminal 3" / "Claude 5" labels repeated across projects, so neither
// Carson nor ADAM could target one terminal by name. Each new terminal and
// Board console gets one of these instead: short, easy to say, and chosen so no
// two sound alike (no name is a prefix of another or one letter away from it).
// Names avoid agent/product names, shell names and common commands, because
// live titles and spoken targets are matched against those.

const NATURE_NAMES = [
  'Juniper',
  'Falcon',
  'Cedar',
  'Maple',
  'Orbit',
  'Willow',
  'Aspen',
  'Birch',
  'Fern',
  'Moss',
  'Oak',
  'Rowan',
  'Alder',
  'Laurel',
  'Cypress',
  'Spruce',
  'Linden',
  'Yarrow',
  'Clover',
  'Thistle',
  'Fennel',
  'Thyme',
  'Lotus',
  'Lupine',
  'Poppy',
  'Daisy',
  'Tulip',
  'Lilac',
  'Dahlia',
  'Aster',
  'Briar',
  'Bramble',
  'Heather',
  'Holly',
  'Ivy',
  'Sedge',
  'Tansy',
  'Zinnia',
  'Marigold',
  'Orchid',
  'Peony',
  'Saffron',
  'Ember',
  'Flint',
  'Slate',
  'Quartz',
  'Onyx',
  'Garnet',
  'Topaz',
  'Coral',
  'Pearl',
  'Cobalt',
  'Copper',
  'Granite',
  'Shale',
  'Pebble',
  'Boulder',
  'Canyon',
  'Mesa',
  'Ridge',
  'Summit',
  'Glacier',
  'Tundra',
  'Delta',
  'Harbor',
  'Cove',
  'Lagoon',
  'Reef',
  'Tide',
  'Brook',
  'River',
  'Creek',
  'Cascade',
  'Meadow',
  'Prairie',
  'Grove',
  'Oasis',
  'Fjord',
  'Atoll',
  'Thunder',
  'Mist',
  'Frost',
  'Breeze',
  'Gale',
  'Zephyr',
  'Aurora',
  'Meteor',
  'Nebula',
  'Pulsar',
  'Orion',
  'Lyra',
  'Altair',
  'Polaris',
  'Luna',
  'Sol',
  'Zenith',
  'Horizon',
  'Dawn',
  'Dusk',
  'Sparrow',
  'Robin',
  'Wren',
  'Finch',
  'Lark',
  'Heron',
  'Crane',
  'Egret',
  'Osprey',
  'Kestrel',
  'Raven',
  'Hawk',
  'Eagle',
  'Owl',
  'Puffin',
  'Pelican',
  'Ibis',
  'Condor',
  'Jay',
  'Starling',
  'Cardinal',
  'Gull',
  'Otter',
  'Beaver',
  'Badger',
  'Lynx',
  'Bobcat',
  'Cougar',
  'Fox',
  'Wolf',
  'Coyote',
  'Bison',
  'Moose',
  'Ibex',
  'Gazelle',
  'Stoat',
  'Lemur',
  'Koala',
  'Panda',
  'Tiger',
  'Lion',
  'Cheetah',
  'Zebra',
  'Rhino',
  'Walrus',
  'Dolphin',
  'Narwhal',
  'Marlin',
  'Salmon',
  'Trout',
  'Minnow',
  'Gecko',
  'Iguana',
  'Turtle',
  'Newt',
  'Cricket',
  'Beetle',
  'Mantis',
  'Monarch',
  'Acorn',
  'Thorn',
  'Bloom',
  'Kelp',
  'Lichen',
  'Tamarack',
  'Hemlock',
  'Sycamore',
  'Tupelo',
  'Bayberry',
  'Cinder',
  'Indigo',
  'Saguaro'
] as const

const PEOPLE_NAMES = [
  'Ava',
  'Leo',
  'Mira',
  'Owen',
  'Nora',
  'Jonah',
  'Eli',
  'Isla',
  'Maya',
  'Liam',
  'Emma',
  'Zoe',
  'Milo',
  'Felix',
  'Hugo',
  'Oscar',
  'Ivan',
  'Elena',
  'Clara',
  'Stella',
  'Hazel',
  'Violet',
  'Rosa',
  'Ines',
  'Nina',
  'Tara',
  'Vera',
  'Wade',
  'Blake',
  'Dean',
  'Kai',
  'Nico',
  'Rafe',
  'Silas',
  'Simon',
  'Abel',
  'Amos',
  'Arlo',
  'Basil',
  'Caleb',
  'Cyrus',
  'Dante',
  'Ezra',
  'Gideon',
  'Hector',
  'Joel',
  'Kurt',
  'Magnus',
  'Malik',
  'Nash',
  'Otis',
  'Pablo',
  'Quinn',
  'Rhys',
  'Rory',
  'Soren',
  'Tomas',
  'Victor',
  'Wyatt',
  'Xavier',
  'Yusuf',
  'Zane',
  'Alma',
  'Anya',
  'Bianca',
  'Celia',
  'Edie',
  'Esme',
  'Faye',
  'Freya',
  'Greta',
  'Hana',
  'Ida',
  'Imogen',
  'Leila',
  'Nadia',
  'Opal',
  'Petra',
  'Rhea',
  'Sadie',
  'Selma',
  'Talia',
  'Vivian',
  'Bruno',
  'Dario',
  'Emil',
  'Fabian',
  'Gus',
  'Knox',
  'Mateo',
  'Nils',
  'Omar',
  'Pedro',
  'Vito',
  'Wes',
  'Yuri',
  'Zeke',
  'Ansel',
  'Enzo',
  'Flora',
  'Ingrid',
  'Jules',
  'Keira',
  'Mae',
  'Nell',
  'Olive',
  'Priya',
  'Quentin',
  'Rocco',
  'Sabine',
  'Tess',
  'Ulric',
  'Vance',
  'Ximena',
  'Yvette',
  'Arden',
  'Beck',
  'Dex',
  'Fiona',
  'Hattie',
  'Kit',
  'Lowell',
  'Nolan',
  'Remy',
  'Sasha',
  'Uma',
  'Yael'
] as const

export const AGENT_NAMES: readonly string[] = [...NATURE_NAMES, ...PEOPLE_NAMES]

/** Words a generated name must never be: commands, agent/product names, shells. */
export const AGENT_NAME_BANNED_WORDS: readonly string[] = [
  'run',
  'stop',
  'start',
  'submit',
  'exit',
  'quit',
  'send',
  'kill',
  'close',
  'open',
  'main',
  'terminal',
  'console',
  'claude',
  'codex',
  'adam',
  'hermes',
  'gemini',
  'cursor',
  'copilot',
  'aider',
  'devin',
  'grok',
  'droid',
  'pi',
  'mimo',
  'opencode',
  'jarvis',
  'orca',
  'dobius',
  'bash',
  'zsh',
  'sh',
  'fish',
  'ash',
  'dash',
  'nu',
  'cmd',
  'echo',
  'cat',
  'git',
  'make',
  'test',
  'ready',
  'idle',
  'done',
  'working',
  'waiting',
  'yes',
  'no',
  'cancel'
]

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * A random name not in `usedNames` (case-insensitive). When every name is
 * taken, returns the first free numbered form of a random one ("Juniper 2").
 */
export function pickAgentName(
  usedNames: Iterable<string>,
  random: () => number = Math.random
): string {
  const used = new Set<string>()
  for (const name of usedNames) {
    if (typeof name === 'string' && name.trim()) {
      used.add(normalizeName(name))
    }
  }
  const free = AGENT_NAMES.filter((name) => !used.has(normalizeName(name)))
  const pool = free.length > 0 ? free : AGENT_NAMES
  const base = pool[pickIndex(pool.length, random)]
  if (free.length > 0) {
    return base
  }
  let suffix = 2
  while (used.has(normalizeName(`${base} ${suffix}`))) {
    suffix += 1
  }
  return `${base} ${suffix}`
}

function pickIndex(length: number, random: () => number): number {
  const value = random()
  const index = Math.floor((Number.isFinite(value) ? value : 0) * length)
  return Math.min(Math.max(index, 0), length - 1)
}

const AGENT_LABEL_SEPARATOR = ' · '
const DEFAULT_TERMINAL_TITLE_RE = /^Terminal \d+$/
const USER_AT_HOST_PROMPT_RE = /^[^\s@]+@[^\s:]+:/
const PATH_TITLE_RE = /^(?:~|\/|[A-Za-z]:[\\/])/

/** A live title that names no work: blank, a default label, a shell or a cwd. */
function isTopicFreeTitle(topic: string): boolean {
  return (
    topic.length === 0 ||
    DEFAULT_TERMINAL_TITLE_RE.test(topic) ||
    isShellProcess(topic) ||
    PATH_TITLE_RE.test(topic) ||
    USER_AT_HOST_PROMPT_RE.test(topic)
  )
}

/**
 * The tab label for a named terminal: "Juniper · Fix login bug" while the live
 * title carries a topic, otherwise just "Juniper". An agent's leading status
 * glyph stays in front ("✳ Juniper · Fix login bug") so title-based status
 * detection and the tab bar's glyph stripping keep working. Idempotent, capped
 * at the tab-title length.
 */
export function formatAgentTabLabel(
  agentName: string | null | undefined,
  liveTitle: string | null | undefined
): string {
  const title = liveTitle ?? ''
  const name = agentName?.trim()
  if (!name) {
    return title
  }
  const lead = title.trimStart()
  const rest = stripLeadingAgentTitleDecorationOrEmpty(lead)
  const decoration = lead.slice(0, lead.length - rest.length)
  const topic = rest.trim()
  const lowerName = name.toLowerCase()
  const lowerTopic = topic.toLowerCase()
  if (lowerTopic === lowerName || lowerTopic.startsWith(`${lowerName}${AGENT_LABEL_SEPARATOR}`)) {
    return title
  }
  if (isTopicFreeTitle(topic)) {
    return `${decoration}${name}`
  }
  const prefix = `${name}${AGENT_LABEL_SEPARATOR}`
  const room = GENERATED_TAB_TITLE_MAX_LENGTH - prefix.length
  if (room <= 1) {
    return `${decoration}${name}`
  }
  const clipped = topic.length > room ? `${topic.slice(0, room - 1).trimEnd()}…` : topic
  return `${decoration}${prefix}${clipped}`
}
