import { useCallback, useState } from 'react'
import BuzzFallbackPage from './BuzzFallbackPage'
import { BuzzWorkspaceHost } from './BuzzWorkspaceHost'

// Why: the Communications UI is bundled with the app (electron.vite.config.ts copies
// vendor/buzz-desktop/dist into out/renderer/buzz), so it must resolve WITHOUT
// VITE_BUZZ_UI_URL being set. Reading that env var alone made the page fall back to
// the placeholder in every normal build.
function resolveBuzzUiUrl(): string {
  const configured = import.meta.env.VITE_BUZZ_UI_URL?.trim()
  if (configured) {
    return configured
  }
  // Dev serves it from the vite root; packaged resolves relative to the loaded page.
  if (import.meta.env.DEV) {
    return new URL('/buzz/index.html?embed=dobius&bridge=4', window.location.origin).href
  }
  return new URL('./buzz/index.html?embed=dobius&bridge=4', window.location.href).href
}

export default function BuzzPage(): React.JSX.Element {
  const [workspaceInstance, setWorkspaceInstance] = useState(0)
  const configuredBuzzUiUrl = resolveBuzzUiUrl()

  // Remounting with a fresh key retries the guest load rather than stranding the tab
  // on the fallback after a transient failure.
  const handleUnavailable = useCallback(() => setWorkspaceInstance((current) => current + 1), [])

  if (configuredBuzzUiUrl.length === 0) {
    return <BuzzFallbackPage />
  }

  return (
    <BuzzWorkspaceHost
      key={workspaceInstance}
      sourceUrl={configuredBuzzUiUrl}
      onUnavailable={handleUnavailable}
    />
  )
}
