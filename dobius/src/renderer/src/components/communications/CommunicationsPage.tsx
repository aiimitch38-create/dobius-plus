import type React from 'react'
import { App } from '@comms/app/App'
import { CommunitiesProvider } from '@comms/features/communities/useCommunities'
import { CommunityOnboardingProvider } from '@comms/features/onboarding/communityOnboarding'
import { UpdaterProvider } from '@comms/features/settings/hooks/UpdaterProvider'
import { ThemeProvider } from '@comms/shared/theme/ThemeProvider'
import { EmojiBurstProvider } from '@comms/shared/ui/EmojiBurstProvider'
import { PoofBurstProvider } from '@comms/shared/ui/PoofBurstProvider'
import { Toaster } from '@comms/shared/ui/sonner'
import { TooltipProvider } from '@comms/shared/ui/tooltip'
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
 * The router inside `App` runs on memory history, so it owns only this subtree
 * and never touches window.location.
 */
export function CommunicationsPage(): React.JSX.Element {
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
