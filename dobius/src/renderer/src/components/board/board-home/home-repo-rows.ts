import { branchName } from '@/lib/git-utils'
import type { Repo, Worktree } from '../../../../../shared/types'
import {
  boardConsoleActivity,
  type BoardActivityInput
} from '../board-route/board-console-activity'

export type HomeRepoRow = {
  repoId: string
  name: string
  /** The folder holding the repo, shown dimmed before the bold repo name. */
  parentPath: string
  path: string
  connectionId: string | null
  /** The workspace "Open board" lands on: the active one, else the most recent. */
  worktreeId: string | null
  branch: string | null
  /** Most recent activity across the repo's workspaces; null when none recorded. */
  lastActivityAt: number | null
  isActive: boolean
  /** The landing workspace already has a board with cards, so opening resumes it. */
  hasBoardSession: boolean
}

export type HomeRepoRowsInput = {
  repos: readonly Repo[]
  worktreesByRepo: Readonly<Record<string, readonly Worktree[]>>
  activeWorktreeId: string | null
  activeRepoId: string | null
  /** Card count per worktree id (only boards that exist). */
  boardCardCounts: Readonly<Record<string, number>>
}

function splitPath(path: string): { parent: string; base: string } {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut < 0
    ? { parent: '', base: trimmed }
    : { parent: trimmed.slice(0, cut + 1), base: trimmed.slice(cut + 1) }
}

function landingWorktree(
  worktrees: readonly Worktree[],
  activeWorktreeId: string | null
): Worktree | null {
  const live = worktrees.filter((w) => !w.isArchived)
  const active = live.find((w) => w.id === activeWorktreeId)
  if (active) {
    return active
  }
  // Same pick as the Board's project switcher: the most recently active workspace.
  return [...live].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0] ?? null
}

/** Rows for the Home repo list: the current repo first, then most recent activity, then name. */
export function buildHomeRepoRows(input: HomeRepoRowsInput): HomeRepoRow[] {
  const activeRepoId =
    input.activeWorktreeId !== null
      ? (Object.entries(input.worktreesByRepo).find(([, list]) =>
          list.some((w) => w.id === input.activeWorktreeId)
        )?.[0] ?? input.activeRepoId)
      : input.activeRepoId
  const rows = input.repos.map((repo): HomeRepoRow => {
    const worktrees = input.worktreesByRepo[repo.id] ?? []
    const landing = landingWorktree(worktrees, input.activeWorktreeId)
    const latest = worktrees.reduce((max, w) => Math.max(max, w.lastActivityAt || 0), 0)
    const { parent } = splitPath(repo.path)
    return {
      repoId: repo.id,
      name: repo.displayName || splitPath(repo.path).base,
      parentPath: parent,
      path: repo.path,
      connectionId: repo.connectionId ?? null,
      worktreeId: landing?.id ?? null,
      branch: landing?.branch ? branchName(landing.branch) : null,
      lastActivityAt: latest > 0 ? latest : null,
      isActive: repo.id === activeRepoId,
      hasBoardSession: landing ? (input.boardCardCounts[landing.id] ?? 0) > 0 : false
    }
  })
  return rows.sort((a, b) => {
    if (a.isActive !== b.isActive) {
      return a.isActive ? -1 : 1
    }
    const byRecent = (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
    return byRecent !== 0 ? byRecent : a.name.localeCompare(b.name)
  })
}

/** Compact age for "idle · 12h": minutes, hours, days, then weeks; null under a minute. */
export function formatIdleAge(sinceMs: number, nowMs: number): string | null {
  const minutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000))
  if (minutes < 1) {
    return null
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  const days = Math.floor(hours / 24)
  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`
}

export type HomeAgentSummary = { working: number; needsYou: number }

/**
 * App-wide agent status for the meta line and the status pill, using the Board
 * top bar's live/needs-you rule over every open tab instead of one board.
 */
export function homeAgentSummary(
  tabIdsByWorktree: Readonly<Record<string, readonly { id: string }[]>>,
  input: BoardActivityInput
): HomeAgentSummary {
  const tabIds = Object.values(tabIdsByWorktree).flatMap((tabs) => tabs.map((t) => t.id))
  const { live, needsYou } = boardConsoleActivity(tabIds, input)
  return { working: live, needsYou }
}
