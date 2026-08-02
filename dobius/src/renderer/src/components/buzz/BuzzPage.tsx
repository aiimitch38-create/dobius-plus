import { useCallback, useState } from 'react'
import BuzzFallbackPage from './BuzzFallbackPage'
import { BuzzWorkspaceHost } from './BuzzWorkspaceHost'

const configuredBuzzUiUrl = import.meta.env.VITE_BUZZ_UI_URL?.trim() ?? ''

export default function BuzzPage(): React.JSX.Element {
  const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false)
  const showFallback = configuredBuzzUiUrl.length === 0 || workspaceUnavailable
  const handleUnavailable = useCallback(() => setWorkspaceUnavailable(true), [])

  if (showFallback) {
    return <BuzzFallbackPage />
  }

  return <BuzzWorkspaceHost sourceUrl={configuredBuzzUiUrl} onUnavailable={handleUnavailable} />
}
