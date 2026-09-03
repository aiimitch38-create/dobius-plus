import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * The restored client's only error boundary.
 *
 * Upstream shipped none — `grep componentDidCatch` across its ~1,500 files
 * returns nothing — which was survivable when it owned the window and a crash
 * was self-evident. Embedded in a tab, a throw unwound to Dobius+'s page-level
 * boundary at best, and rendered a blank panel with no log line at worst.
 *
 * This exists to make the next failure legible rather than to recover from it:
 * the message and stack are shown, not swallowed, because a silent white
 * screen cost a full debugging session that a visible error name would have
 * ended in a minute.
 */
export class CommunicationsErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[communications] render error', error, info.componentStack)
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-8 text-center"
        role="alert"
      >
        <p className="text-sm font-medium">Communications hit an error.</p>
        <p className="text-muted-foreground max-w-lg font-mono text-xs break-words">
          {error.message || String(error)}
        </p>
        <button
          className="mt-2 rounded-full border px-4 py-1.5 text-xs"
          onClick={this.handleRetry}
          type="button"
        >
          Retry
        </button>
      </div>
    )
  }
}
