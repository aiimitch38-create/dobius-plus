import type {
  RuntimeTerminalAgentStatus,
  RuntimeTerminalRead,
  RuntimeTerminalSummary
} from '../../shared/runtime-types'

export type LoopDeliveryStatus = 'sent' | 'no-terminal' | 'no-agent' | 'permission' | 'not-writable'

/** The two terminal operations Board loops need, addressed by stable tab id. */
export type LoopTerminals = {
  /** New lines after `cursor` (null cursor = baseline read). Null when the tab has no live terminal. */
  read: (
    tabId: string,
    cursor: string | null
  ) => Promise<{ lines: string[]; cursor: string | null } | null>
  /**
   * Delivers an instruction to the agent running in the tab, never to a bare
   * shell: refused unless a live agent owns the terminal right before each write.
   */
  deliver: (tabId: string, text: string) => Promise<LoopDeliveryStatus>
}

type RuntimeTerminalAccess = {
  listTerminals: () => Promise<{ terminals: RuntimeTerminalSummary[] }>
  readTerminal: (
    handle: string,
    opts?: { cursor?: number; limit?: number }
  ) => Promise<RuntimeTerminalRead>
  getTerminalAgentStatus: (handle: string) => Promise<RuntimeTerminalAgentStatus>
  sendTerminal: (
    handle: string,
    action: { text?: string; enter?: boolean },
    options?: { beforeWrite?: (ptyId: string) => void | Promise<void> }
  ) => Promise<unknown>
}

const READ_LIMIT = 400
// Shorter than the 5s loop tick, so each tick lists terminals exactly once.
const LISTING_TTL_MS = 1_000
const ESCAPE = '\u001b'
const BRACKETED_PASTE_START = `${ESCAPE}[200~`
const BRACKETED_PASTE_END = `${ESCAPE}[201~`
// Why: matches the renderer notes-send pacing between paste and submit.
const POST_PASTE_SUBMIT_DELAY_MS = 50

/**
 * Strips every control character except tab and newline. Why: with ESC gone the
 * text can't close the bracketed paste early, and with CR gone nothing in it can
 * submit a line on its own; only our separate Enter submits.
 */
export function sanitizeLoopPasteText(text: string): string {
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
}

class LoopDeliveryRefused extends Error {
  constructor(readonly status: LoopDeliveryStatus) {
    super(`loop_delivery_${status}`)
  }
}

// Why: handles are reissued when PTYs change, so resolve tab -> handle per call
// through the runtime's public listing instead of caching handles.
export function createRuntimeLoopTerminals(
  getRuntime: () => RuntimeTerminalAccess | null,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): LoopTerminals {
  // Why: one loop tick reads and delivers to many tabs; list terminals once
  // per tick instead of once per call. Stale handles are harmless: every write
  // re-checks the agent, and a reissued handle simply fails that check.
  let listing: { at: number; terminals: Promise<RuntimeTerminalSummary[]> } | null = null
  const handleFor = async (tabId: string): Promise<string | null> => {
    const runtime = getRuntime()
    if (!runtime) {
      return null
    }
    const now = Date.now()
    if (!listing || now - listing.at > LISTING_TTL_MS) {
      listing = { at: now, terminals: runtime.listTerminals().then((r) => r.terminals) }
      listing.terminals.catch(() => {
        listing = null
      })
    }
    const terminals = await listing.terminals
    return terminals.find((t) => t.tabId === tabId)?.handle ?? null
  }
  return {
    read: async (tabId, cursor) => {
      const runtime = getRuntime()
      const handle = await handleFor(tabId)
      if (!runtime || !handle) {
        return null
      }
      const parsed = cursor === null ? Number.NaN : Number(cursor)
      const read = await runtime.readTerminal(handle, {
        ...(Number.isFinite(parsed) ? { cursor: parsed } : {}),
        limit: READ_LIMIT
      })
      // A baseline read only records where "now" is; its scrollback is never judged.
      return {
        lines: cursor === null ? [] : read.tail,
        cursor:
          cursor === null
            ? (read.latestCursor ?? read.nextCursor ?? null)
            : (read.nextCursor ?? read.latestCursor ?? cursor)
      }
    },
    deliver: async (tabId, text) => {
      const runtime = getRuntime()
      const handle = await handleFor(tabId)
      if (!runtime || !handle) {
        return 'no-terminal'
      }
      // Why: if the agent exited, the PTY belongs to a shell and anything typed
      // would run as a command. Re-checked immediately before every write.
      const assertAgent = async (): Promise<void> => {
        const status = await runtime.getTerminalAgentStatus(handle)
        if (!status.isRunningAgent) {
          throw new LoopDeliveryRefused('no-agent')
        }
        if (status.status === 'permission') {
          throw new LoopDeliveryRefused('permission')
        }
      }
      try {
        await assertAgent()
        await runtime.sendTerminal(
          handle,
          { text: `${BRACKETED_PASTE_START}${sanitizeLoopPasteText(text)}${BRACKETED_PASTE_END}` },
          { beforeWrite: assertAgent }
        )
        await wait(POST_PASTE_SUBMIT_DELAY_MS)
        await runtime.sendTerminal(handle, { enter: true }, { beforeWrite: assertAgent })
        return 'sent'
      } catch (error) {
        if (error instanceof LoopDeliveryRefused) {
          return error.status
        }
        if (error instanceof Error && /not_writable|unavailable|not_found/.test(error.message)) {
          return 'not-writable'
        }
        throw error
      }
    }
  }
}
