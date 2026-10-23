import React, { useState } from 'react'
import { Braces, Loader2, Radar, Smartphone } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { worktreeDevServers } from './dev-server-url'
import { WEB_TILE_DEVICES } from './web-tile-devices'

const NAV_BUTTON =
  'flex size-7 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] disabled:opacity-40'

type DevServer = { port: number; url: string; label: string }

/** Device picker, dev-port rescan and Web Inspector for one web tile. */
export function WebTileExtras({
  worktreeId,
  deviceId,
  onDevice,
  onNavigate,
  inspectorOpen,
  onOpenInspector,
  onOpenDetachedInspector
}: {
  worktreeId: string
  deviceId: string | null
  onDevice: (deviceId: string | null) => void
  onNavigate: (url: string) => void
  inspectorOpen: boolean
  /** Toggles the inspector docked beside the page. */
  onOpenInspector: () => void
  /** Shift-click: Chromium's separate DevTools window instead. */
  onOpenDetachedInspector: () => void
}): React.JSX.Element {
  const [servers, setServers] = useState<DevServer[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const rescan = (): void => {
    setServers(null)
    setScanError(null)
    const repoId = findWorktreeById(useAppStore.getState().worktreesByRepo, worktreeId)?.repoId
    window.api.workspacePorts.scan({ repoId }).then(
      (result) => {
        setServers(worktreeDevServers(result.ports, worktreeId))
        setScanError(result.unavailableReason ?? null)
      },
      (error: unknown) => {
        setServers([])
        setScanError(error instanceof Error ? error.message : String(error))
      }
    )
  }

  const deviceLabel = translate('board.web.device', 'Simulate a device viewport')
  const scanLabel = translate('board.web.rescan', 'Rescan dev ports')
  const inspectorLabel = inspectorOpen
    ? translate('board.web.closeInspector', 'Close the Web Inspector')
    : translate('board.web.inspector', 'Open the Web Inspector')
  const inspectorHint = translate(
    'board.web.inspectorHint',
    'Web Inspector · Shift-click to open it in its own window'
  )
  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && rescan()}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={scanLabel} title={scanLabel} className={NAV_BUTTON}>
            <Radar className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4}>
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
            {translate('board.web.devServers', 'Dev servers in this workspace')}
          </DropdownMenuLabel>
          {servers === null ? (
            <div className="flex items-center gap-2 px-2 py-1 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {translate('board.web.scanning', 'Scanning…')}
            </div>
          ) : servers.length === 0 ? (
            <div className="max-w-64 px-2 py-1 text-[12px] text-muted-foreground">
              {scanError ??
                translate('board.web.noServers', 'No dev server is listening for this workspace.')}
            </div>
          ) : (
            servers.map((server) => (
              <DropdownMenuItem key={server.port} onSelect={() => onNavigate(server.url)}>
                <span className="font-mono text-[12px]">{server.label}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={deviceLabel}
            title={deviceLabel}
            aria-pressed={deviceId !== null}
            className={`${NAV_BUTTON} aria-pressed:text-[var(--board-accent)]`}
          >
            <Smartphone className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4}>
          <DropdownMenuRadioGroup
            value={deviceId ?? 'fill'}
            onValueChange={(value) => onDevice(value === 'fill' ? null : value)}
          >
            <DropdownMenuRadioItem value="fill">
              {translate('board.web.deviceFill', 'Fit the tile')}
            </DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            {WEB_TILE_DEVICES.map((device) => (
              <DropdownMenuRadioItem key={device.id} value={device.id}>
                {device.label}
                <span className="ml-auto pl-3 font-mono text-[11px] text-muted-foreground">
                  {device.width}×{device.height}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={inspectorLabel}
        aria-pressed={inspectorOpen}
        title={inspectorHint}
        onClick={(e) => (e.shiftKey ? onOpenDetachedInspector() : onOpenInspector())}
        className={`${NAV_BUTTON} aria-pressed:text-[var(--board-accent)]`}
      >
        <Braces className="size-4" />
      </button>
    </>
  )
}
