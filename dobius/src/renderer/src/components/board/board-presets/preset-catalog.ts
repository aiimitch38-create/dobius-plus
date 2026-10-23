import { translate } from '@/i18n/i18n'
import type { BoardSwatch } from '@/store/slices/board'
import type { TuiAgent } from '../../../../../shared/types'

/** A console's agent: any registry agent, or a plain shell. */
export type PresetAgent = TuiAgent | 'shell'

export type PresetLane = {
  id: string
  name: string
  color: BoardSwatch
  count: number
  agent: PresetAgent
}

export type PresetExtra =
  | { kind: 'orchestrator' }
  | { kind: 'kanban' }
  | { kind: 'web'; url: string }

export type PresetDefinition = {
  id: string
  section: 'workspace' | 'plain'
  name: string
  description: string
  lanes: PresetLane[]
  extras: PresetExtra[]
}

/** Agents offered in "Fill every lane with", in cycle order for a lane icon click. */
export const FILL_AGENTS: readonly PresetAgent[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
  'grok',
  'shell'
]

export function nextPresetAgent(current: PresetAgent): PresetAgent {
  const index = FILL_AGENTS.indexOf(current)
  return FILL_AGENTS[(index + 1) % FILL_AGENTS.length] ?? 'claude'
}

const lane = (id: string, name: string, color: BoardSwatch, count: number): PresetLane => ({
  id,
  name,
  color,
  count,
  agent: 'claude'
})

const PREVIEW_URL = 'http://localhost:3000'

// Why: built per call so names and copy follow the current UI language.
export function presetCatalog(): PresetDefinition[] {
  const t = translate
  return [
    {
      id: 'command-deck',
      section: 'workspace',
      name: t('board.presets.catalog.commandDeck.name', 'Command Deck'),
      description: t(
        'board.presets.catalog.commandDeck.description',
        'Everything at once: two build crews on either side of a shared task board and a live preview, a review crew below, and one orchestrator directing all of them.'
      ),
      lanes: [
        lane('ui', t('board.presets.lane.interface', 'Interface'), 'yellow', 4),
        lane('review', t('board.presets.lane.review', 'Review'), 'blue', 4),
        lane('services', t('board.presets.lane.services', 'Services'), 'purple', 4)
      ],
      extras: [{ kind: 'orchestrator' }, { kind: 'kanban' }, { kind: 'web', url: PREVIEW_URL }]
    },
    {
      id: 'pairing-bay',
      section: 'workspace',
      name: t('board.presets.catalog.pairingBay.name', 'Pairing Bay'),
      description: t(
        'board.presets.catalog.pairingBay.description',
        'Two pairs working one task board: one pair writes, the other checks the work. Small enough to follow every console.'
      ),
      lanes: [
        lane('writers', t('board.presets.lane.writers', 'Writers'), 'yellow', 2),
        lane('checkers', t('board.presets.lane.checkers', 'Checkers'), 'purple', 2)
      ],
      extras: [{ kind: 'orchestrator' }, { kind: 'kanban' }]
    },
    {
      id: 'preview-lab',
      section: 'workspace',
      name: t('board.presets.catalog.previewLab.name', 'Preview Lab'),
      description: t(
        'board.presets.catalog.previewLab.description',
        'Front-end work with the running app in view: builders change the page, testers click through it in the live preview.'
      ),
      lanes: [
        lane('builders', t('board.presets.lane.builders', 'Builders'), 'pink', 2),
        lane('testers', t('board.presets.lane.testers', 'Testers'), 'yellow', 3)
      ],
      extras: [{ kind: 'orchestrator' }, { kind: 'web', url: PREVIEW_URL }]
    },
    {
      id: 'release-train',
      section: 'workspace',
      name: t('board.presets.catalog.releaseTrain.name', 'Release Train'),
      description: t(
        'board.presets.catalog.releaseTrain.description',
        'A release in four stations: plan it, build it, test it, write it up. Each station is a pair, all reporting to one orchestrator.'
      ),
      lanes: [
        lane('plan', t('board.presets.lane.plan', 'Plan'), 'yellow', 2),
        lane('build', t('board.presets.lane.build', 'Build'), 'green', 2),
        lane('test', t('board.presets.lane.test', 'Test'), 'purple', 2),
        lane('docs', t('board.presets.lane.docs', 'Docs'), 'blue', 2)
      ],
      extras: [{ kind: 'orchestrator' }]
    },
    {
      id: 'triage-desk',
      section: 'workspace',
      name: t('board.presets.catalog.triageDesk.name', 'Triage Desk'),
      description: t(
        'board.presets.catalog.triageDesk.description',
        'For a bad day: three agents reproduce and narrow down bugs, two fix what they find, tracked on one task board.'
      ),
      lanes: [
        lane('repro', t('board.presets.lane.reproduce', 'Reproduce'), 'green', 3),
        lane('fix', t('board.presets.lane.fix', 'Fix'), 'blue', 2)
      ],
      extras: [{ kind: 'kanban' }]
    },
    ...plainPresets()
  ]
}

function plainPresets(): PresetDefinition[] {
  const t = translate
  const consoles = t('board.presets.lane.consoles', 'Consoles')
  const description = t(
    'board.presets.plain.description',
    'Consoles with no roles or extras, grouped and ready for your first instruction.'
  )
  const sizes: { id: string; groups: number; each: number; name: string }[] = [
    { id: 'two-up', groups: 1, each: 2, name: t('board.presets.plain.twoUp', 'Two up') },
    { id: 'three-up', groups: 1, each: 3, name: t('board.presets.plain.threeUp', 'Three up') },
    { id: 'four-up', groups: 1, each: 4, name: t('board.presets.plain.fourUp', 'Four up') },
    {
      id: 'two-by-four',
      groups: 2,
      each: 4,
      name: t('board.presets.plain.twoByFour', 'Eight in two groups')
    },
    {
      id: 'three-by-four',
      groups: 3,
      each: 4,
      name: t('board.presets.plain.threeByFour', 'Twelve in three groups')
    },
    {
      id: 'four-by-four',
      groups: 4,
      each: 4,
      name: t('board.presets.plain.fourByFour', 'Sixteen in four groups')
    }
  ]
  const colors: BoardSwatch[] = ['yellow', 'blue', 'purple', 'green']
  return sizes.map((size) => ({
    id: size.id,
    section: 'plain',
    name: size.name,
    description,
    lanes: Array.from({ length: size.groups }, (_, i) =>
      lane(
        `g${i + 1}`,
        size.groups === 1 ? consoles : `${consoles} ${i + 1}`,
        colors[i % colors.length],
        size.each
      )
    ),
    extras: []
  }))
}

export function presetConsoleCount(preset: Pick<PresetDefinition, 'lanes'>): number {
  return preset.lanes.reduce((n, l) => n + l.count, 0)
}
