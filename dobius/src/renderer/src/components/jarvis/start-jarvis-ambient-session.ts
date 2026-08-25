import type { JarvisCaptureControls, JarvisSessionRegistry } from './jarvis-capture-controls'

export type JarvisAmbientSessionHandle = { dispose: () => void }

type StartAmbientSessionOptions = {
  modelId: string
  sessionId: string
  registry: JarvisSessionRegistry
  capture: JarvisCaptureControls
  waitForStopped: (sessionId: string) => Promise<void>
  onActive: () => void
  onFailed: () => void
}

/**
 * Starts the continuous wake-word dictation session. Why a dedicated always-on
 * session gated on an explicit user toggle: it keeps one getUserMedia stream +
 * STT worker alive indefinitely — a real CPU/battery cost the user opted into.
 */
export function startJarvisAmbientSession(
  options: StartAmbientSessionOptions
): JarvisAmbientSessionHandle {
  const { registry, capture, sessionId } = options
  const ambientRunId = registry.runId.current + 1000
  registry.runId.current = ambientRunId
  registry.kind.current = 'ambient'
  registry.sessionId.current = sessionId

  let disposed = false
  void (async () => {
    try {
      await capture.start({ bufferAudio: true, sessionId })
      if (disposed || registry.runId.current !== ambientRunId) {
        return
      }
      await window.api.speech.startDictation(options.modelId, undefined, sessionId)
      if (disposed || registry.runId.current !== ambientRunId) {
        return
      }
      await capture.flushBufferedAudio()
      if (!disposed && registry.runId.current === ambientRunId) {
        options.onActive()
      }
    } catch {
      if (!disposed && registry.runId.current === ambientRunId) {
        registry.kind.current = null
        registry.sessionId.current = null
        capture.stop()
        capture.discardBufferedAudio()
        void options.waitForStopped(sessionId)
        options.onFailed()
      }
    }
  })()

  return {
    dispose: () => {
      if (disposed || registry.kind.current !== 'ambient') {
        return
      }
      disposed = true
      registry.kind.current = null
      registry.sessionId.current = null
      registry.grabActive.current = false
      capture.stop()
      void window.api.speech.stopDictation(sessionId).catch(() => undefined)
      void options.waitForStopped(sessionId)
    }
  }
}
