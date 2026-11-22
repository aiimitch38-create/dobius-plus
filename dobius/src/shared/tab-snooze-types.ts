// Snoozed tabs: the shape main keeps for a tab that was closed to come back
// later, plus the pure rules for cleaning and timing it. Ported from Sam's
// electron/tab-snooze.js; this app keys entries by worktree id + tab id.
import type { SleepingAgentSessionRecord } from './agent-session-resume'
import { parsePaneKey } from './stable-pane-id'
import { isValidHostTerminalTabId } from './terminal-tab-id'
import { sleepingAgentSessionsByPaneKeySchema } from './workspace-session-sleeping-agents'

export const MAX_SNOOZED_TABS = 100
// Why capped: the timer is re-armed from there, so a far-off wake survives a
// sleeping Mac and setTimeout's 24.8-day ceiling never matters.
export const SNOOZE_TIMER_MAX_MS = 6 * 60 * 60 * 1000
const TITLE_MAX = 100
const PREVIEW_MAX = 200
const IDENTITY_MAX = 512
const PATH_MAX = 4096

export type SnoozedTabRef = { worktreeId: string; tabId: string }

export type SnoozedTabEntry = SnoozedTabRef & {
  title: string
  snoozedAt: number
  /** When it comes back (ms), or null for "until I bring it back". */
  until: number | null
  /** Its time has come; the worktree's window takes it back. */
  ready: boolean
  customTitle?: string
  color?: string
  pinned?: true
  viewMode?: 'chat'
  launchAgent?: string
  startupCwd?: string
  shellOverride?: string
  /** The agent conversation the tab was on. Its resumeOwner is what the
   *  session-claim gate checks when the tab returns. */
  agentSession?: SleepingAgentSessionRecord
  preview?: string
  /** Where main keeps the tab's output (terminal-scrollback-snapshots). */
  scrollbackRef?: string
  /** Handed to a window that is reopening it. It stays in the list (off the
   *  shelf) until that tab's terminal has really started, so a restart in
   *  between cannot lose the conversation. */
  returning?: true
  /** The tab the window is reopening it as, so a retry reuses that tab. */
  returnTabId?: string
}

export type TakenSnoozedTab = { entry: SnoozedTabEntry; scrollback: string | null }

export type SnoozeTabRequest = SnoozedTabRef & {
  until: number | null
  title: string
  customTitle?: string | null
  color?: string | null
  pinned?: boolean
  viewMode?: 'terminal' | 'chat'
  launchAgent?: string | null
  startupCwd?: string | null
  shellOverride?: string | null
  agentSession?: SleepingAgentSessionRecord | null
  preview?: string | null
  /** Serialized terminal output, kept by main in the scrollback snapshot store. */
  scrollback?: string | null
}

export type SnoozeTabResult =
  | { ok: true; entry: SnoozedTabEntry }
  | { ok: false; reason: 'invalid' | 'full' | 'conversation-not-resumable' }

export function snoozedTabKey(ref: SnoozedTabRef): string {
  return `${ref.worktreeId}\0${ref.tabId}`
}

export function sameSnoozedTab(left: SnoozedTabRef, right: SnoozedTabRef): boolean {
  return left.worktreeId === right.worktreeId && left.tabId === right.tabId
}

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

function safeString(value: unknown, max: number): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !hasControlChars(value)
    ? value
    : null
}

export function parseSnoozedTabRef(value: unknown): SnoozedTabRef | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  const worktreeId = safeString(raw.worktreeId, IDENTITY_MAX)
  const tabId = safeString(raw.tabId, 256)
  if (!worktreeId || !tabId || !isValidHostTerminalTabId(tabId)) {
    return null
  }
  return { worktreeId, tabId }
}

function cleanAgentSession(
  raw: unknown,
  ref: SnoozedTabRef
): SleepingAgentSessionRecord | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const paneKey = (raw as Record<string, unknown>).paneKey
  if (typeof paneKey !== 'string') {
    return undefined
  }
  // Why the map schema: it is the one the session file uses, and it drops a
  // resumeOwner that does not match its own record.
  const parsed = sleepingAgentSessionsByPaneKeySchema.safeParse({ [paneKey]: raw })
  const record = parsed.success ? parsed.data?.[paneKey] : undefined
  if (!record || record.worktreeId !== ref.worktreeId) {
    return undefined
  }
  if (parsePaneKey(record.paneKey)?.tabId !== ref.tabId) {
    return undefined
  }
  return record as SleepingAgentSessionRecord
}

/** Pure: a stored entry made safe, or null. Everything here came from a renderer or a file. */
export function cleanSnoozedTabEntry(value: unknown): SnoozedTabEntry | null {
  const ref = parseSnoozedTabRef(value)
  if (!ref) {
    return null
  }
  const raw = value as Record<string, unknown>
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Tab'
  const out: SnoozedTabEntry = {
    ...ref,
    title: title.slice(0, TITLE_MAX),
    snoozedAt: Number.isFinite(raw.snoozedAt) ? (raw.snoozedAt as number) : Date.now(),
    until: Number.isFinite(raw.until) ? (raw.until as number) : null,
    ready: raw.ready === true
  }
  if (typeof raw.customTitle === 'string' && raw.customTitle.trim()) {
    out.customTitle = raw.customTitle.slice(0, TITLE_MAX)
  }
  if (typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)) {
    out.color = raw.color
  }
  if (raw.pinned === true) {
    out.pinned = true
  }
  if (raw.viewMode === 'chat') {
    out.viewMode = 'chat'
  }
  if (typeof raw.launchAgent === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(raw.launchAgent)) {
    out.launchAgent = raw.launchAgent
  }
  const startupCwd = safeString(raw.startupCwd, PATH_MAX)
  if (startupCwd) {
    out.startupCwd = startupCwd
  }
  const shellOverride = safeString(raw.shellOverride, PATH_MAX)
  if (shellOverride) {
    out.shellOverride = shellOverride
  }
  const agentSession = cleanAgentSession(raw.agentSession, ref)
  if (agentSession) {
    out.agentSession = agentSession
  }
  if (typeof raw.preview === 'string' && raw.preview.trim()) {
    out.preview = raw.preview.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX)
  }
  if (typeof raw.scrollbackRef === 'string' && /^v1-[0-9a-f]{32}$/.test(raw.scrollbackRef)) {
    out.scrollbackRef = raw.scrollbackRef
  }
  if (raw.returning === true) {
    out.returning = true
  }
  const returnTabId = safeString(raw.returnTabId, 256)
  if (returnTabId && isValidHostTerminalTabId(returnTabId)) {
    out.returnTabId = returnTabId
  }
  return out
}

/** Pure: a list from disk made safe: bad rows dropped, one row per tab, capped. */
export function cleanSnoozedTabEntries(value: unknown): SnoozedTabEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  const byKey = new Map<string, SnoozedTabEntry>()
  for (const raw of value) {
    const entry = cleanSnoozedTabEntry(raw)
    if (entry) {
      byKey.set(snoozedTabKey(entry), entry)
    }
  }
  return [...byKey.values()].slice(0, MAX_SNOOZED_TABS)
}

type Timed = Pick<SnoozedTabEntry, 'until' | 'ready' | 'returning'>

const waitsOnTime = (entry: Timed): boolean =>
  !entry.ready && !entry.returning && entry.until != null

/** Pure: entries whose time has come and are not ready yet. */
export function dueSnoozedTabs<T extends Timed>(entries: readonly T[], now: number): T[] {
  return entries.filter((entry) => waitsOnTime(entry) && (entry.until as number) <= now)
}

/** Pure: ms until the next wake to arm for, or null when nothing is waiting on a time. */
export function nextSnoozeDelay(entries: readonly Timed[], now: number): number | null {
  let next: number | null = null
  for (const entry of entries) {
    if (waitsOnTime(entry) && (next === null || (entry.until as number) < next)) {
      next = entry.until
    }
  }
  return next === null ? null : Math.min(Math.max(0, next - now), SNOOZE_TIMER_MAX_MS)
}
