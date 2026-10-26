// A console wired to a web tile: the console drives the tile (as agent id
// `console-<short card id>`) and can be asked to verify its own changes there.
// Pure rules: identity, lookups, pruning, cables and the texts typed into the
// console. No DOM, no store.
import type { BoardCard, BoardCardOf, BoardState } from '@/store/slices/board'
import { isValidAgentDisplayName } from '../../../../../shared/agent-identity-names'
import { webTileBrowserPageId } from '../../../../../shared/board-web-tile-popup'
import type { BoardCable } from '../board-links/board-link-geometry'

export const CONSOLE_DRIVER_PREFIX = 'console-'
const SHORT_ID_LENGTH = 8

/** Agent id a console drives tiles as: `console-` + the first 8 chars of its card id, lowercased. */
export function consoleDriverAgentId(consoleCardId: string): string {
  const short = consoleCardId
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, SHORT_ID_LENGTH)
  return `${CONSOLE_DRIVER_PREFIX}${short || '0'}`
}

/**
 * Cursor / claim-chip name for a console driver: the console's title when it
 * is a valid, non-reserved agent display name, else the capitalized agent id
 * (what main derives). A console titled "Carson" never names its cursor that.
 */
export function consoleDriverName(title: string, agentId: string): string {
  const trimmed = title.trim()
  if (trimmed && isValidAgentDisplayName(trimmed)) {
    return trimmed
  }
  return agentId.charAt(0).toUpperCase() + agentId.slice(1)
}

export function isConsoleDriverAgentId(agentId: string): boolean {
  return agentId.startsWith(CONSOLE_DRIVER_PREFIX)
}

/** The console card whose derived agent id is `agentId`, if it is on the board. */
export function consoleForDriverAgentId(
  cards: readonly BoardCard[],
  agentId: string
): BoardCardOf<'console'> | null {
  if (!isConsoleDriverAgentId(agentId)) {
    return null
  }
  return (
    cards.find(
      (c): c is BoardCardOf<'console'> =>
        c.kind === 'console' && consoleDriverAgentId(c.id) === agentId
    ) ?? null
  )
}

/** The console wired to drive `tile`, or null when none / it is gone. */
export function driverConsoleOf(
  cards: readonly BoardCard[],
  tile: BoardCardOf<'web'>
): BoardCardOf<'console'> | null {
  if (!tile.driverCardId) {
    return null
  }
  const card = cards.find((c) => c.id === tile.driverCardId)
  return card?.kind === 'console' ? card : null
}

/** Web tiles a console drives. */
export function tilesDrivenBy(
  cards: readonly BoardCard[],
  consoleCardId: string
): BoardCardOf<'web'>[] {
  return cards.filter(
    (c): c is BoardCardOf<'web'> => c.kind === 'web' && c.driverCardId === consoleCardId
  )
}

/** Cables from each console to the tiles it drives; the packet speeds up while the console works. */
export function browserLinkCables(board: Pick<BoardState, 'cards'>): BoardCable[] {
  return board.cards.flatMap((card): BoardCable[] => {
    if (card.kind !== 'web') {
      return []
    }
    const driver = driverConsoleOf(board.cards, card)
    return driver
      ? [
          {
            id: `${driver.id}->tile:${card.id}`,
            from: driver,
            to: card,
            orchestratorId: driver.id,
            targetTabIds: [driver.tabId]
          }
        ]
      : []
  })
}

export type BrowserLinkIdentity = {
  pageId: string
  agentId: string
  name: string
}

export function browserLinkIdentity(
  tile: Pick<BoardCardOf<'web'>, 'id'>,
  driver: Pick<BoardCardOf<'console'>, 'id' | 'title'>
): BrowserLinkIdentity {
  const agentId = consoleDriverAgentId(driver.id)
  return {
    pageId: webTileBrowserPageId(tile.id),
    agentId,
    name: consoleDriverName(driver.title, agentId)
  }
}

/** Shell-safe double quoting for a value typed into the console. */
function q(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

const INTERPOLATED_MAX = 200

/** One line, no control characters, bounded: a card title or URL can't break the typed block. */
export function plainLine(value: string): string {
  // eslint-disable-next-line no-control-regex -- strips C0/C1 controls and line separators
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > INTERPOLATED_MAX ? `${cleaned.slice(0, INTERPOLATED_MAX - 1)}…` : cleaned
}

function tileUrl(tile: Pick<BoardCardOf<'web'>, 'url'>): string {
  return plainLine(tile.url) || 'http://localhost:3000'
}

function target(id: BrowserLinkIdentity): string {
  return `--page ${id.pageId} --as ${id.agentId}`
}

/** Typed into the console when it is connected to a tile. Commands match src/cli/specs. */
export function browserHandoffText(
  tile: Pick<BoardCardOf<'web'>, 'id' | 'url' | 'title'>,
  driver: Pick<BoardCardOf<'console'>, 'id' | 'title'>
): string {
  const id = browserLinkIdentity(tile, driver)
  const t = target(id)
  const url = tileUrl(tile)
  return [
    `[Dobius Board] You are connected to the web tile "${plainLine(tile.title)}" (${url}). You drive it as ${id.name} (agent id ${id.agentId}); your page id is ${id.pageId}. Use it as your live browser to check your own work.`,
    '',
    `Commands (ALWAYS pass --as ${id.agentId}: Dobius refuses that identity outside this tile, and a command without it is not held to this tile):`,
    `  dobius snapshot ${t} --json            # accessibility tree with element refs`,
    `  dobius click --element <ref> ${t}`,
    `  dobius hover --element <ref> ${t}`,
    `  dobius scroll --direction down --amount 600 ${t}`,
    `  dobius fill --element <ref> --value ${q('text')} ${t}`,
    `  dobius keypress --key Enter ${t}`,
    `  dobius goto --url ${q(url)} ${t}       # reload = goto the same URL`,
    `  dobius screenshot ${t} --json | jq -r .result.data | base64 -d > shot.png`,
    '',
    'Rules:',
    `  - Stay in this tile (${id.pageId}). Never open or drive other pages, tiles or browser tabs; never drop or change --as.`,
    '  - Never log in, sign up, buy, pay, send, publish or delete anything. Leave gated actions for the human.',
    '  - Only the dobius browser commands above (synthetic input inside the page). Never use dobius computer, the real mouse or keyboard, or any other browser for this work.',
    '  - If the human clicks or types in the tile, you are paused: stop and wait until Dobius resumes you.',
    '',
    'Report:',
    '  - Save screenshots to files (see the screenshot command) and name them in your reply.',
    `  - If you hold a Kanban card: dobius tasks attach --id <task-id> --file shot.png --by ${id.agentId}`
  ].join('\n')
}

/** Typed into the console when Verify is pressed on a connected tile. */
export function browserVerifyText(
  tile: Pick<BoardCardOf<'web'>, 'id' | 'url' | 'title'>,
  driver: Pick<BoardCardOf<'console'>, 'id' | 'title'>
): string {
  const id = browserLinkIdentity(tile, driver)
  const t = target(id)
  const url = tileUrl(tile)
  return [
    `[Dobius Board] Verify your last change in the web tile "${plainLine(tile.title)}" (${id.pageId}, as ${id.agentId}). Always pass --as ${id.agentId}.`,
    `1. Take a BEFORE screenshot, then reload: dobius goto --url ${q(url)} ${t}`,
    '2. Walk through the page(s) your last change touched with your cursor: snapshot, scroll, hover, and click non-destructive controls only (no login, purchase, send, publish or delete).',
    '3. Take AFTER screenshots of what you checked; save them to files.',
    '4. Report what is fixed and what is still wrong, one line each, naming the screenshot files.',
    `5. If you hold a Kanban card, attach the screenshots: dobius tasks attach --id <task-id> --file <shot.png> --by ${id.agentId}`
  ].join('\n')
}
