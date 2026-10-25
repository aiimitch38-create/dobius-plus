import React, { useState } from 'react'
import {
  ExternalLink,
  Github,
  Keyboard,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCw,
  School
} from 'lucide-react'
import { toast } from 'sonner'
import logo from '../../../../../resources/logo.svg'
import { useAppStore } from '@/store'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useMountedRef } from '@/hooks/useMountedRef'
import { cn } from '@/lib/utils'
import { showOnboardingFromRenderer } from '../onboarding/show-onboarding-event'
import { SetupGuideProgressRing } from '../setup-guide/SetupGuideProgressRing'
import { useSetupGuideProgress } from '../setup-guide/use-setup-guide-progress'
import { translate } from '@/i18n/i18n'
import { getUpdateCheckClickOptions, getUpdateCheckHint } from '@/lib/update-check-click-options'

const GITHUB_URL = 'https://github.com/statusdigitalmarketing/dobius-plus'
const NO_UPDATE_CHECK_MODIFIERS = { ctrlKey: false, metaKey: false, shiftKey: false }

function openExternalUrl(url: string): void {
  void window.api.shell.openUrl(url)
}

export type HelpMenuItemsProps = {
  /** Onboarding replay and Restart: shown only when the opener held Option/Alt. */
  showAdminOptions: boolean
  /** The feedback dialog must live outside the menu content; the host owns it. */
  onSendFeedback: () => void
  itemClassName?: string
  separatorClassName?: string
}

// The Help menu rows shared by the Classic sidebar footer and the Board top bar.
// Renders inside an open DropdownMenuContent, so per-open refs start fresh.
export function HelpMenuItems({
  showAdminOptions,
  onSendFeedback,
  itemClassName,
  separatorClassName
}: HelpMenuItemsProps): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const setupProgress = useSetupGuideProgress(true, false, false)
  const [isRestartingDobius, setIsRestartingDobius] = useState(false)
  const lastShowOnboardingAtRef = React.useRef(0)
  const updateCheckModifiersRef = React.useRef(NO_UPDATE_CHECK_MODIFIERS)
  const mountedRef = useMountedRef()
  const updateCheckHint = getUpdateCheckHint()

  const showMilestones =
    setupProgress.ready && setupProgress.coreDoneCount < setupProgress.coreTotal

  const handleShowOnboarding = (): void => {
    const now = Date.now()
    if (now - lastShowOnboardingAtRef.current < 500) {
      return
    }
    lastShowOnboardingAtRef.current = now
    void showOnboardingFromRenderer()
  }

  const handleRestartDobius = (): void => {
    if (isRestartingDobius) {
      return
    }
    setIsRestartingDobius(true)
    toast.info(
      translate('auto.components.sidebar.SidebarSettingsHelpMenu.5161eef55d', 'Restarting Dobius+…')
    )
    void window.api.app.restart().catch((error) => {
      if (mountedRef.current) {
        setIsRestartingDobius(false)
        toast.error(
          translate(
            'auto.components.sidebar.SidebarSettingsHelpMenu.4e8f5710d3',
            "Couldn't restart Dobius+."
          ),
          {
            description: error instanceof Error ? error.message : undefined
          }
        )
      }
    })
  }

  const openShortcutsSettings = (): void => {
    openSettingsTarget({ pane: 'shortcuts', repoId: null })
    openSettingsPage()
  }

  const handleCheckForUpdatesPointerDown = (event: React.PointerEvent): void => {
    updateCheckModifiersRef.current = {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    }
  }

  const handleCheckForUpdates = (): void => {
    const modifiers = updateCheckModifiersRef.current
    updateCheckModifiersRef.current = NO_UPDATE_CHECK_MODIFIERS
    void window.api.updater.check(getUpdateCheckClickOptions(modifiers))
  }

  const openMilestones = (): void => {
    openModal('setup-guide', { telemetrySource: 'help_menu' })
  }

  return (
    <>
      <DropdownMenuItem className={itemClassName} onSelect={openShortcutsSettings}>
        <Keyboard className="size-3.5" />
        {translate('auto.components.sidebar.SidebarSettingsHelpMenu.e565171a7c', 'Keyboard Shortcuts')}
      </DropdownMenuItem>
      <DropdownMenuSeparator className={separatorClassName} />
      <DropdownMenuItem className={itemClassName} onSelect={onSendFeedback}>
        <MessageSquareText className="size-3.5" />
        {translate('auto.components.sidebar.SidebarSettingsHelpMenu.4cf5b868d7', 'Send Feedback')}
      </DropdownMenuItem>
      {showMilestones ? (
        <DropdownMenuItem className={itemClassName} onSelect={openMilestones}>
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="size-3.5 object-contain invert opacity-55 dark:invert-0"
          />
          {translate('auto.components.sidebar.SidebarSettingsHelpMenu.f8a2c91d4e', 'Milestones')}
          <SetupGuideProgressRing
            done={setupProgress.coreDoneCount}
            total={setupProgress.coreTotal}
            sizeClassName="size-4"
            className="ml-auto"
          />
        </DropdownMenuItem>
      ) : null}
      {showAdminOptions ? (
        <DropdownMenuItem
          className={cn('whitespace-nowrap', itemClassName)}
          onClick={handleShowOnboarding}
          onSelect={handleShowOnboarding}
        >
          <School className="size-3.5" />
          {translate('auto.components.sidebar.SidebarSettingsHelpMenu.b7e4d2a19c', 'Onboarding')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator className={separatorClassName} />
      <DropdownMenuItem className={itemClassName} onSelect={() => openExternalUrl(GITHUB_URL)}>
        <Github className="size-3.5" />
        {translate('auto.components.sidebar.SidebarSettingsHelpMenu.5687ab246a', 'GitHub')}
        <ExternalLink className="ml-auto size-3 text-muted-foreground" />
      </DropdownMenuItem>
      <DropdownMenuSeparator className={separatorClassName} />
      <DropdownMenuItem
        className={itemClassName}
        disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
        onPointerDown={handleCheckForUpdatesPointerDown}
        onSelect={handleCheckForUpdates}
        title={updateCheckHint}
      >
        {updateStatus.state === 'checking' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        {translate('auto.components.sidebar.SidebarSettingsHelpMenu.29c56f30ee', 'Check for Updates')}
      </DropdownMenuItem>
      {showAdminOptions ? (
        <>
          <DropdownMenuSeparator className={separatorClassName} />
          <DropdownMenuItem
            className={itemClassName}
            onSelect={handleRestartDobius}
            disabled={isRestartingDobius}
          >
            <RotateCw className="size-3.5" />
            {translate('auto.components.sidebar.SidebarSettingsHelpMenu.ad3d3ed7f1', 'Restart Dobius+')}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )
}
