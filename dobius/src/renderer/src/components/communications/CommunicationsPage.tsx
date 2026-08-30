import type React from 'react'
import { useEffect, useState } from 'react'
import { App } from '@comms/app/App'
import { CommunitiesProvider } from '@comms/features/communities/useCommunities'
import { CommunityOnboardingProvider } from '@comms/features/onboarding/communityOnboarding'
import { UpdaterProvider } from '@comms/features/settings/hooks/UpdaterProvider'
import { ThemeProvider } from '@comms/shared/theme/ThemeProvider'
import { EmojiBurstProvider } from '@comms/shared/ui/EmojiBurstProvider'
import { PoofBurstProvider } from '@comms/shared/ui/PoofBurstProvider'
import { Toaster } from '@comms/shared/ui/sonner'
import { TooltipProvider } from '@comms/shared/ui/tooltip'
import { primeDobiusIdentity } from '@comms/shared/api/dobiusCommunications'
import { LoadingMark } from '@comms/shared/ui/dobius-logo/LoadingMark'
import '@comms/shared/styles/globals.css'

/**
 * The Communications tab.
 *
 * This is the provider stack the restored client's standalone `main.tsx` used,
 * minus the parts that only make sense for an app that owns the window: no
 * ReactDOM.createRoot, no dev/E2E bridge installation, and deliberately no
 * identity bootstrap. That bootstrap wrote a Nostr private key into
 * localStorage in plain text; identity now lives in the main process, encrypted
 * (participant-identity-store), which is the hole Phase 4's migration closed.
 * Reintroducing it here would reopen it.
 *
 * Because of that, the identity has to be fetched from main before any of the
 * client renders: its command layer reads `.pubkey` synchronously while
 * building relay tags and filters, so a subtree mounted ahead of the fetch
 * throws on its very first query. Priming here is what replaces the bootstrap.
 *
 * The router inside `App` runs on memory history, so it owns only this subtree
 * and never touches window.location.
 */
export function CommunicationsPage(): React.JSX.Element {
  const [identityState, setIdentityState] = useState<'loading' | 'ready' | string>('loading')

  useEffect(() => {
    let cancelled = false
    primeDobiusIdentity()
      .then(() => {
        if (!cancelled) setIdentityState('ready')
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setIdentityState(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (identityState === 'loading') {
    return (
      <div className="flex h-full min-h-0 items-center justify-center" role="status">
        <span className="sr-only">Loading Communications…</span>
        <LoadingMark className="h-auto w-20" />
      </div>
    )
  }

  if (identityState !== 'ready') {
    // Surfaced rather than swallowed: without an identity every relay call in
    // the client fails, and a silent loading state is indistinguishable from a
    // hang — which is exactly how the missing identity first presented.
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">Communications could not load your identity.</p>
        <p className="text-muted-foreground max-w-md text-xs">{identityState}</p>
      </div>
    )
  }

  return (
    <CommunitiesProvider>
      <CommunityOnboardingProvider>
        <ThemeProvider defaultTheme="buzz">
          <TooltipProvider delayDuration={300}>
            <EmojiBurstProvider>
              <PoofBurstProvider>
                <UpdaterProvider>
                  <App />
                </UpdaterProvider>
                <Toaster />
              </PoofBurstProvider>
            </EmojiBurstProvider>
          </TooltipProvider>
        </ThemeProvider>
      </CommunityOnboardingProvider>
    </CommunitiesProvider>
  )
}

export default CommunicationsPage
