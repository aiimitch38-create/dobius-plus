import { useEffect, useRef, useState } from 'react'

type BuzzWorkspaceHostProps = {
  sourceUrl: string
  onUnavailable: () => void
}

export function BuzzWorkspaceHost({
  sourceUrl,
  onUnavailable
}: BuzzWorkspaceHostProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    // Why: Buzz owns global routing and styles. A guest renderer preserves its
    // complete UX without allowing those globals to leak into Dobius+ chrome.
    const webview = document.createElement('webview') as Electron.WebviewTag
    webview.setAttribute('partition', 'persist:dobius-buzz')
    webview.setAttribute('src', sourceUrl)
    webview.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes')
    webview.style.width = '100%'
    webview.style.height = '100%'
    webview.style.border = '0'
    webview.style.display = 'flex'

    const handleReady = (): void => setLoaded(true)
    const handleFailure = (): void => onUnavailable()
    webview.addEventListener('dom-ready', handleReady)
    webview.addEventListener('did-fail-load', handleFailure)
    container.appendChild(webview)

    return () => {
      webview.removeEventListener('dom-ready', handleReady)
      webview.removeEventListener('did-fail-load', handleFailure)
      webview.remove()
    }
  }, [onUnavailable, sourceUrl])

  return (
    <div className="relative flex min-h-0 flex-1 bg-background" data-testid="buzz-workspace-host">
      {!loaded ? (
        <div className="absolute inset-0 z-10 grid place-items-center text-sm text-muted-foreground">
          Opening Buzz workspace…
        </div>
      ) : null}
      <div ref={containerRef} className="flex min-h-0 flex-1" />
    </div>
  )
}
