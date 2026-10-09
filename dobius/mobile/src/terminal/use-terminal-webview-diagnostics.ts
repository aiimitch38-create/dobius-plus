import { useCallback, useMemo, useRef } from 'react'
import {
  createTerminalWebViewLifecycleReporter,
  createTerminalWebViewNativeErrorHandlers,
  handleTerminalWebViewGeometryMessage,
  reportTerminalWebViewActiveState,
  type TerminalWebViewDiagnosticOptions
} from './terminal-webview-lifecycle-diagnostics'

export function useTerminalWebViewDiagnostics<Event>(
  options: TerminalWebViewDiagnosticOptions,
  reportNativeEngineError: (message: string, event: Event) => void
) {
  const generationRef = useRef(0)
  const snapshotRef = useRef({ ...options, generation: 0 })
  Object.assign(snapshotRef.current, options, { generation: generationRef.current })

  const reportLifecycleEvent = useMemo(
    () => createTerminalWebViewLifecycleReporter(() => snapshotRef.current),
    []
  )
  const nativeErrorHandlers = useMemo(
    () => createTerminalWebViewNativeErrorHandlers(reportLifecycleEvent, reportNativeEngineError),
    [reportLifecycleEvent, reportNativeEngineError]
  )

  const handleDiagnosticMessage = useCallback(
    (message: unknown): boolean =>
      handleTerminalWebViewGeometryMessage(snapshotRef.current, message),
    []
  )
  const handleLoadStart = useCallback(() => {
    generationRef.current += 1
    snapshotRef.current.generation = generationRef.current
    reportLifecycleEvent('load-start')
  }, [reportLifecycleEvent])
  const reportActiveState = useCallback(
    (postProbeCommand: (command: { type: 'geometry-probe'; active: boolean }) => void) =>
      reportTerminalWebViewActiveState(
        options.active,
        options.enabled,
        reportLifecycleEvent,
        postProbeCommand
      ),
    [options.active, options.enabled, reportLifecycleEvent]
  )

  return {
    handleDiagnosticMessage,
    handleLoadStart,
    nativeErrorHandlers,
    reportActiveState,
    reportLifecycleEvent
  }
}
