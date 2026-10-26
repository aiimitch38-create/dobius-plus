import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { buildGitHubRepoUrl } from '@/lib/github-links'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
import { useAppStore } from '@/store'
import { useRepoById, useWorktreesForRepo } from '@/store/selectors'
import { refreshGitStatusForWorktree } from '@/components/right-sidebar/git-status-refresh'
import type { GitUpstreamStatus } from '../../../../../shared/git-status-types'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import {
  groupByWorkspacePurpose,
  workspacePurposeKey
} from '../../../../../shared/workspace-purpose'
import { BOARD_MONO_CLASS } from '../board-chrome/board-surface-classes'

export type WorkspaceGitRow = {
  id: string
  name: string
  branch: string
  purpose?: string
  /** null until git status has been fetched for this worktree. */
  changedCount: number | null
  /** undefined until upstream status has been fetched for this worktree. */
  upstream: GitUpstreamStatus | undefined
}

export type SourceControlView = 'current' | 'workspaces'

function upstreamLabel(upstream: GitUpstreamStatus | undefined): string {
  if (!upstream) {
    return translate('board.workspaces.stateLoading', 'checking…')
  }
  if (!upstream.hasUpstream) {
    return translate('board.workspaces.notPublished', 'not published')
  }
  if (upstream.ahead === 0 && upstream.behind === 0) {
    return translate('board.workspaces.synced', 'synced')
  }
  const parts: string[] = []
  if (upstream.ahead > 0) {
    parts.push(translate('board.workspaces.ahead', '{{count}} ahead', { count: upstream.ahead }))
  }
  if (upstream.behind > 0) {
    parts.push(
      translate('board.workspaces.behind', '{{count}} behind', { count: upstream.behind })
    )
  }
  return parts.join(' · ')
}

function changesLabel(changedCount: number | null): string {
  if (changedCount === null) {
    return ''
  }
  return changedCount === 0
    ? translate('board.workspaces.clean', 'clean')
    : translate('board.workspaces.changed', '{{count}} changed', { count: changedCount })
}

export type SourceControlWorkspacesListProps = {
  rows: readonly WorkspaceGitRow[]
  activeWorktreeId: string | null
  collapsedGroups: ReadonlySet<string>
  onToggleGroup: (key: string) => void
  onSelect: (worktreeId: string) => void
  /** The per-worktree Source Control panel, rendered under the expanded row. */
  children: React.ReactNode
}

// Presentational: purpose sections → one row per worktree; the active row is
// expanded and hosts `children` (the real Source Control panel for it).
export function SourceControlWorkspacesList({
  rows,
  activeWorktreeId,
  collapsedGroups,
  onToggleGroup,
  onSelect,
  children
}: SourceControlWorkspacesListProps): React.JSX.Element {
  const groups = useMemo(() => groupByWorkspacePurpose(rows), [rows])
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.key)
        const label = group.purpose ?? translate('board.workspaces.other', 'Other')
        return (
          <section key={group.key} aria-label={label}>
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={() => onToggleGroup(group.key)}
              className="flex h-9 w-full items-center gap-2 border-b border-[var(--board-panel-border)] bg-[var(--board-panel-2)] px-4 text-left text-[11px] font-semibold tracking-[0.06em] text-[var(--board-text-muted)] uppercase hover:text-[var(--board-text)]"
            >
              <ChevronDown
                className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')}
              />
              <span className="truncate">{label}</span>
              <span className="min-w-[17px] rounded-full bg-[var(--board-panel)] px-1 text-center text-[11px] leading-[17px] tabular-nums">
                {group.items.length}
              </span>
            </button>
            {collapsed
              ? null
              : group.items.map((row) => {
                  const active = row.id === activeWorktreeId
                  const changes = changesLabel(row.changedCount)
                  return (
                    <div key={row.id} className="border-b border-[var(--board-panel-border)]">
                      <button
                        type="button"
                        aria-expanded={active}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => onSelect(row.id)}
                        className={cn(
                          'flex h-10 w-full items-center gap-3 px-4 text-left text-[13px] hover:bg-[var(--board-panel-2)]',
                          active && 'bg-[var(--board-accent-tint)]'
                        )}
                      >
                        <GitBranch
                          className={cn(
                            'size-4 shrink-0',
                            active
                              ? 'text-[var(--board-accent)]'
                              : 'text-[var(--board-text-muted)]'
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate font-semibold text-[var(--board-text)]">
                          {row.name}
                        </span>
                        <span
                          className={cn(
                            BOARD_MONO_CLASS,
                            'hidden max-w-[220px] truncate text-[12px] text-[var(--board-text-muted)] sm:inline'
                          )}
                        >
                          {row.branch}
                        </span>
                        <span className="shrink-0 text-[12px] text-[var(--board-text-muted)] tabular-nums">
                          {upstreamLabel(row.upstream)}
                        </span>
                        {changes ? (
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 text-[11px] leading-[18px] tabular-nums',
                              row.changedCount
                                ? 'bg-[var(--board-accent-tint)] text-[var(--board-accent)]'
                                : 'bg-[var(--board-panel-2)] text-[var(--board-text-muted)]'
                            )}
                          >
                            {changes}
                          </span>
                        ) : null}
                      </button>
                      {active ? (
                        <div className="flex h-[min(560px,62vh)] min-h-0 flex-col overflow-hidden border-t border-[var(--board-panel-border)]">
                          {children}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
          </section>
        )
      })}
    </div>
  )
}

function ViewToggle({
  view,
  onChange,
  onOpenGitHub
}: {
  view: SourceControlView
  onChange: (view: SourceControlView) => void
  onOpenGitHub: () => void
}): React.JSX.Element {
  const openLabel = translate('board.workspaces.openOnGitHub', 'Open on GitHub')
  const option = (id: SourceControlView, label: string): React.JSX.Element => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      onClick={() => onChange(id)}
      className={cn(
        'h-7 rounded-full px-3 text-[12px] font-semibold transition-colors',
        view === id
          ? 'bg-[var(--board-accent-tint)] text-[var(--board-accent)]'
          : 'text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]'
      )}
    >
      {label}
    </button>
  )
  return (
    <div
      role="tablist"
      aria-label={translate('board.workspaces.viewLabel', 'Source Control view')}
      className="flex shrink-0 items-center gap-1 border-b border-[var(--board-panel-border)] px-4 py-2"
    >
      {option('current', translate('board.workspaces.viewCurrent', 'Current workspace'))}
      {option('workspaces', translate('board.workspaces.viewAll', 'All workspaces'))}
      <button
        type="button"
        title={openLabel}
        aria-label={openLabel}
        onClick={onOpenGitHub}
        className="ml-auto flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-[var(--board-text-muted)] transition-colors hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]"
      >
        <ExternalLink className="size-3.5" />
        {openLabel}
      </button>
    </div>
  )
}

/** Opens the repo on github.com; GitLab/other hosts and SSH repos get a toast. */
async function openRepoOnGitHub(repo: { id: string; path: string; connectionId?: string | null }): Promise<void> {
  const slug = repo.connectionId
    ? null
    : await window.api.gh.repoSlug({ repoPath: repo.path, repoId: repo.id }).catch(() => null)
  const url = buildGitHubRepoUrl(slug)
  if (!url) {
    toast.message(translate('board.github.none', 'This project has no GitHub remote.'))
    return
  }
  await window.api.shell.openUrl(url)
}

function branchLabel(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

/**
 * Wraps the hosted Source Control panel with a "by workspace" view: the
 * active repo's worktrees grouped by purpose, each with branch, sync state and
 * changed-file count. Selecting a row activates that worktree (the Board
 * switches in place), so the embedded panel — and every git action in it —
 * targets that worktree's path without any new git plumbing.
 */
export function SourceControlWorkspacesView({
  worktreeId,
  children
}: {
  worktreeId: string
  children: React.ReactNode
}): React.JSX.Element {
  const repoId = useAppStore((s) => s.getKnownWorktreeById(worktreeId)?.repoId ?? null)
  const repo = useRepoById(repoId)
  const worktrees = useWorktreesForRepo(repoId)
  const gitStatusByWorktree = useAppStore((s) => s.gitStatusByWorktree)
  const remoteStatusesByWorktree = useAppStore((s) => s.remoteStatusesByWorktree)
  const [viewOverride, setViewOverride] = useState<SourceControlView | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const fetchedRef = useRef(new Set<string>())

  const visible = useMemo(() => worktrees.filter((w) => !w.isArchived), [worktrees])
  const isGitRepo = repo != null && !isFolderRepo(repo)
  // Why: one worktree has nothing to group; the owner asked for the grouped
  // view as the default once there are several.
  const view: SourceControlView =
    viewOverride ?? (isGitRepo && visible.length > 1 ? 'workspaces' : 'current')

  const rows = useMemo<WorkspaceGitRow[]>(
    () =>
      visible.map((w) => ({
        id: w.id,
        name: w.displayName.trim() || branchLabel(w.branch) || w.id,
        branch: branchLabel(w.branch),
        ...(w.purpose ? { purpose: w.purpose } : {}),
        changedCount: gitStatusByWorktree[w.id]?.length ?? null,
        upstream: remoteStatusesByWorktree[w.id]
      })),
    [gitStatusByWorktree, remoteStatusesByWorktree, visible]
  )

  // Why: status for non-active worktrees is fetched once, lazily, only for rows
  // currently shown (expanded group) — no polling loop. The active worktree is
  // already kept fresh by the embedded Source Control panel.
  useEffect(() => {
    if (view !== 'workspaces' || !repo || !isGitRepo) {
      return
    }
    const state = useAppStore.getState()
    const settings = getRepoOwnerRoutedSettings(state.settings, repo)
    for (const w of visible) {
      if (
        w.id === worktreeId ||
        fetchedRef.current.has(w.id) ||
        state.gitStatusByWorktree[w.id] !== undefined ||
        collapsedGroups.has(workspacePurposeKey(w.purpose))
      ) {
        continue
      }
      fetchedRef.current.add(w.id)
      void refreshGitStatusForWorktree({
        settings,
        worktreeId: w.id,
        worktreePath: w.path,
        connectionId: repo.connectionId ?? undefined,
        pushTarget: w.pushTarget,
        deps: {
          setGitStatus: state.setGitStatus,
          updateWorktreeGitIdentity: state.updateWorktreeGitIdentity,
          setUpstreamStatus: state.setUpstreamStatus,
          fetchUpstreamStatus: state.fetchUpstreamStatus
        }
      }).catch(() => {
        // Why: let a later open retry instead of pinning a failed worktree as "checking…".
        fetchedRef.current.delete(w.id)
      })
    }
  }, [collapsedGroups, isGitRepo, repo, view, visible, worktreeId])

  if (!isGitRepo) {
    return <>{children}</>
  }

  return (
    <>
      <ViewToggle
        view={view}
        onChange={setViewOverride}
        onOpenGitHub={() => void openRepoOnGitHub(repo)}
      />
      {view === 'current' ? (
        children
      ) : (
        <SourceControlWorkspacesList
          rows={rows}
          activeWorktreeId={worktreeId}
          collapsedGroups={collapsedGroups}
          onToggleGroup={(key) =>
            setCollapsedGroups((prev) => {
              const next = new Set(prev)
              if (next.has(key)) {
                next.delete(key)
              } else {
                next.add(key)
              }
              return next
            })
          }
          onSelect={(id) => {
            if (id !== worktreeId) {
              activateAndRevealWorktree(id, { keepView: true })
            }
          }}
        >
          {children}
        </SourceControlWorkspacesList>
      )}
    </>
  )
}
