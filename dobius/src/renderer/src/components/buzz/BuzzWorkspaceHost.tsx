import { useEffect, useRef, useState } from 'react'
import { DOBIUS_COMMUNICATIONS_PARTITION } from '../../../../shared/communications-bridge'

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
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    // Why: Buzz owns global routing and styles. A guest renderer preserves its
    // complete UX without allowing those globals to leak into Dobius+ chrome.
    const webview = document.createElement('webview') as Electron.WebviewTag
    // Why: main-process webview hardening rejects partitions that are not in
    // the browser session registry. The default Dobius browser partition is
    // registered before renderer boot and remains an unprivileged guest.
    webview.setAttribute('partition', DOBIUS_COMMUNICATIONS_PARTITION)
    webview.setAttribute('src', sourceUrl)
    webview.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes')
    webview.style.width = '100%'
    webview.style.height = '100%'
    webview.style.border = '0'
    webview.style.display = 'flex'

    const handleReady = (): void => setLoaded(true)
    const handleFailure = (event: Electron.DidFailLoadEvent): void => {
      if (event.errorCode === -3) {
        return
      }
      setLoadError(`${event.errorDescription} (${event.errorCode})`)
    }
    const handleGone = (): void =>
      setLoadError('The Communications workspace stopped unexpectedly.')
    webview.addEventListener('dom-ready', handleReady)
    webview.addEventListener('did-fail-load', handleFailure)
    webview.addEventListener('render-process-gone', handleGone)
    container.appendChild(webview)

    return () => {
      webview.removeEventListener('dom-ready', handleReady)
      webview.removeEventListener('did-fail-load', handleFailure)
      webview.removeEventListener('render-process-gone', handleGone)
      webview.remove()
    }
  }, [onUnavailable, sourceUrl])

  return (
    <div className="relative flex min-h-0 flex-1 bg-background" data-testid="buzz-workspace-host">
      {loadError ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background px-8 text-center">
          <div>
            <p className="text-sm font-medium">Communications could not open</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
            <button
              type="button"
              className="mt-4 text-xs text-primary underline underline-offset-4"
              onClick={onUnavailable}
            >
              Retry Communications
            </button>
          </div>
        </div>
      ) : !loaded ? (
        <div className="absolute inset-0 z-10 grid place-items-center text-sm text-muted-foreground">
          Opening Communications…
        </div>
      ) : null}
      <div ref={containerRef} className="flex min-h-0 flex-1" />
    </div>
  )
}
