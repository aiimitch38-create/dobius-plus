// Why: the Home shares the Board's fonts (SIL OFL) and loads them with its own lazy chunk.
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { VoiceOrb } from '@/components/dictation/VoiceOrb'
import { voiceOrbLevelSource } from '@/components/dictation/voice-orb-live-level'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { openWorktreePath } from '@/components/sidebar/WorktreeOpenInMenu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { isBoardShortcutBlockedTarget } from '../board-chrome/board-tools'
import { BOARD_MONO_CLASS } from '../board-chrome/board-surface-classes'
import { listBoardPresets } from '../board-presets/board-preset-store'
import type { BoardPreset } from '../board-presets/board-preset'
import { presetCatalog } from '../board-presets/preset-catalog'
import { homeGreetingName, pickHomeGreeting } from './home-greeting'
import { moveHomeSelection, reconcileHomeSelection, resolveHomeKey } from './home-keyboard'
import { openWorkspaceOnBoard, type HomePresetChoice } from './home-open'
import { buildHomeRepoRows, homeAgentSummary, type HomeRepoRow } from './home-repo-rows'
import { HomeLauncherBar } from './HomeLauncherBar'
import { HomeRepoList, type HomeRepoRowActions } from './HomeRepoList'
import { HomeTopPills, homeStatusText } from './HomeTopPills'
import { electronVersionFromUserAgent, homeVersionLabel } from './home-version'

const isMac = navigator.userAgent.includes('Mac')
const MOD = isMac ? '⌘' : 'Ctrl'
const SHIFT = isMac ? '⇧' : 'Shift'
const KEY_CAP_CLASS =
  'border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[var(--board-text-muted)] shadow-none'

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Re-align to the next minute boundary, then tick once a minute.
    let interval: ReturnType<typeof setInterval> | undefined
    const timeout = setTimeout(
      () => {
        setNow(new Date())
        interval = setInterval(() => setNow(new Date()), 60_000)
      },
      60_000 - (Date.now() % 60_000)
    )
    return () => {
      clearTimeout(timeout)
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [])
  return now
}

function useAppVersion(): string | null {
  const buildVersion = import.meta.env.VITE_DOBIUS_APP_VERSION as string | undefined
  const [version, setVersion] = useState<string | null>(() =>
    homeVersionLabel(buildVersion, null, null)
  )
  useEffect(() => {
    if (buildVersion) {
      return
    }
    let alive = true
    window.api.updater
      .getVersion()
      .then((v) => {
        if (alive) {
          setVersion(
            homeVersionLabel(buildVersion, v, electronVersionFromUserAgent(navigator.userAgent))
          )
        }
      })
      .catch((e: unknown) => console.warn('[board-home] app version unavailable', e))
    return () => {
      alive = false
    }
  }, [buildVersion])
  return version
}

function useHomeRows(): HomeRepoRow[] {
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const boardsByWorktree = useAppStore((s) => s.boardsByWorktree)
  return useMemo(() => {
    const boardCardCounts: Record<string, number> = {}
    for (const [id, board] of Object.entries(boardsByWorktree)) {
      boardCardCounts[id] = board.cards.length
    }
    return buildHomeRepoRows({
      repos,
      worktreesByRepo,
      activeWorktreeId,
      activeRepoId,
      boardCardCounts
    })
  }, [activeRepoId, activeWorktreeId, boardsByWorktree, repos, worktreesByRepo])
}

// Why: like the Board, Home is a full-window layer over the Classic shell so the
// shell (and every live terminal in it) stays mounted underneath.
export default function BoardHome(): React.JSX.Element {
  const now = useMinuteClock()
  const version = useAppVersion()
  const confirm = useConfirmationDialog()
  const rows = useHomeRows()
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const acknowledgedAgentsByPaneKey = useAppStore((s) => s.acknowledgedAgentsByPaneKey)
  // Why: re-derive freshness whenever the status feed ticks.
  useAppStore((s) => s.agentStatusEpoch)
  const summary = homeAgentSummary(tabsByWorktree, {
    agentStatusByPaneKey,
    acknowledgedAgentsByPaneKey,
    now: Date.now(),
    staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
  })

  const [pickedRepoId, setPickedRepoId] = useState<string | null>(null)
  const selectedRepoId = reconcileHomeSelection(
    pickedRepoId,
    rows.map((r) => r.repoId)
  )
  const selected = rows.find((r) => r.repoId === selectedRepoId) ?? null

  // Name: Settings > General "Your name" wins; otherwise the git/GitHub
  // username the Board avatar already shows (current repo first).
  const userName = useAppStore((s) => {
    const current = s.repos.find((r) => r.id === s.activeRepoId)?.gitUsername
    const git = current || s.repos.find((r) => r.gitUsername)?.gitUsername || null
    return homeGreetingName(s.settings?.displayName, git)
  })
  const greeting = pickHomeGreeting(now, userName)

  const catalog = useMemo(() => presetCatalog(), [])
  const [userPresets, setUserPresets] = useState<BoardPreset[]>([])
  const [preset, setPreset] = useState<HomePresetChoice>(null)
  useEffect(() => {
    if (!selectedRepoId) {
      setUserPresets([])
      return
    }
    let alive = true
    listBoardPresets(selectedRepoId)
      .then((list) => {
        if (alive) {
          setUserPresets(list)
        }
      })
      .catch((e: unknown) => console.warn('[board-home] saved presets unavailable', e))
    // A saved preset belongs to its repo; drop it when the repo changes.
    setPreset((current) => (current?.kind === 'user' ? null : current))
    return () => {
      alive = false
    }
  }, [selectedRepoId])

  const [opening, setOpening] = useState(false)
  const openRow = useCallback(
    async (row: HomeRepoRow | null, choice: HomePresetChoice) => {
      if (!row || opening) {
        return
      }
      setOpening(true)
      try {
        await openWorkspaceOnBoard(row.worktreeId, choice, confirm)
      } finally {
        setOpening(false)
      }
    },
    [confirm, opening]
  )

  const openFolder = useCallback(async () => {
    const repo = await useAppStore.getState().addRepo()
    if (repo) {
      setPickedRepoId(repo.id)
    }
  }, [])

  const actions = useMemo<HomeRepoRowActions>(
    () => ({
      onSelect: setPickedRepoId,
      // The row's own button opens plainly; the launcher's preset applies to the launcher button.
      onOpen: (row) => void openRow(row, null),
      onReveal: (row) =>
        void openWorktreePath({
          target: 'file-manager',
          worktreePath: row.path,
          connectionId: row.connectionId
        }),
      onRemove: async (row) => {
        // Same copy and effect as the sidebar's Remove Project dialog.
        const ok = await confirm({
          title: translate(
            'auto.components.sidebar.RemoveFolderDialog.b79b39d865',
            'Remove Project'
          ),
          description: `${translate(
            'auto.components.sidebar.RemoveFolderDialog.e62415c3d0',
            'This only removes'
          )} ${row.name} ${translate(
            'auto.components.sidebar.RemoveFolderDialog.8c097ef04e',
            'from Dobius+. It is still on your disk.'
          )}`,
          confirmLabel: translate(
            'auto.components.sidebar.RemoveFolderDialog.4dc5b5065b',
            'Remove'
          ),
          confirmVariant: 'destructive'
        })
        if (ok) {
          await useAppStore
            .getState()
            .removeProject(row.repoId)
            .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
        }
      }
    }),
    [confirm, openRow]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) {
        return
      }
      if (useAppStore.getState().activeModal !== 'none' || isBoardShortcutBlockedTarget(e.target)) {
        return
      }
      const action = resolveHomeKey(e, isMac)
      if (!action) {
        return
      }
      // A focused button or link handles its own Enter.
      if (
        action === 'open' &&
        e.target instanceof Element &&
        e.target.closest('button, a, [role="button"]')
      ) {
        return
      }
      e.preventDefault()
      const ids = rows.map((r) => r.repoId)
      const index = selectedRepoId ? ids.indexOf(selectedRepoId) : -1
      switch (action) {
        case 'up':
        case 'down': {
          const next = moveHomeSelection(index, action === 'up' ? -1 : 1, ids.length)
          const id = ids[next]
          if (id) {
            setPickedRepoId(id)
            document.getElementById(`home-repo-${id}`)?.scrollIntoView({ block: 'nearest' })
          }
          return
        }
        case 'open':
          void openRow(selected, preset)
          return
        case 'openFolder':
          void openFolder()
          return
        case 'switch':
          useAppStore.getState().openModal('worktree-palette')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openFolder, openRow, preset, rows, selected, selectedRepoId])

  const dateText = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const repoCountText =
    rows.length === 1
      ? translate('board.home.meta.repoOne', '1 repo')
      : translate('board.home.meta.repos', '{{count}} repos', { count: rows.length })

  return (
    <div
      data-surface="board"
      className="fixed inset-0 z-40 overflow-y-auto bg-[var(--board-canvas)]"
      style={{
        backgroundImage:
          'radial-gradient(circle, var(--board-dot) 1px, transparent 1.5px), linear-gradient(var(--board-canvas), var(--board-canvas-bottom))',
        backgroundSize: '24px 24px, 100% 100%'
      }}
    >
      <HomeTopPills summary={summary} now={now} />

      <main className="mx-auto flex min-h-full w-full max-w-[720px] flex-col items-center px-6 pt-[88px] pb-24">
        <VoiceOrb size={112} getLevel={() => voiceOrbLevelSource.current()} className="mb-6" />
        <h1 className="text-center text-[34px] leading-tight font-semibold tracking-[-0.02em]">
          {greeting.line}
          {greeting.name ? (
            <>
              , <span className="text-[var(--board-accent)]">{greeting.name}</span>
            </>
          ) : null}
          .
        </h1>
        <p className="mt-2 text-center text-[15px] text-[var(--board-text-muted)]">
          {greeting.tagline}
        </p>
        <p
          className={cn(
            'mt-3 text-center text-[12px] text-[var(--board-text-muted)]',
            BOARD_MONO_CLASS
          )}
        >
          {dateText} · {repoCountText} · {homeStatusText(summary)}
        </p>

        <div className="mt-8 w-full">
          <HomeLauncherBar
            rows={rows}
            selected={selected}
            onSelectRepo={setPickedRepoId}
            catalog={catalog}
            userPresets={userPresets}
            preset={preset}
            onSelectPreset={setPreset}
            opening={opening}
            onOpen={() => void openRow(selected, preset)}
          />
        </div>

        <div className="mt-8 w-full">
          <HomeRepoList
            rows={rows}
            selectedRepoId={selectedRepoId}
            now={now.getTime()}
            actions={actions}
            onAddRepo={() => useAppStore.getState().openModal('add-repo')}
          />
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-[var(--board-text-muted)]">
          <span className="flex items-center gap-1.5">
            <ShortcutKeyCombo keys={['↵']} keyCapClassName={KEY_CAP_CLASS} />
            {translate('board.home.hint.open', 'open')}
          </span>
          <span className="flex items-center gap-1.5">
            <ShortcutKeyCombo keys={[MOD, 'O']} keyCapClassName={KEY_CAP_CLASS} />
            {translate('board.home.hint.openFolder', 'open folder')}
          </span>
          <span className="flex items-center gap-1.5">
            <ShortcutKeyCombo keys={[MOD, SHIFT, 'L']} keyCapClassName={KEY_CAP_CLASS} />
            {translate('board.home.hint.switch', 'switch')}
          </span>
        </footer>
      </main>

      {version ? (
        <div
          className={cn(
            'pointer-events-none absolute right-[18px] bottom-3 text-[11px] text-[var(--board-text-muted)]',
            BOARD_MONO_CLASS
          )}
        >
          {translate('board.home.version', 'v{{version}}', { version })}
        </div>
      ) : null}
    </div>
  )
}
