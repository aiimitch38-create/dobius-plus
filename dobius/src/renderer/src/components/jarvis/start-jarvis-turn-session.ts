import type { JarvisCaptureControls, JarvisSessionRegistry } from './jarvis-capture-controls'

export type JarvisTurnSessionHandle = {
  /** Abort while startup is still in flight (mirrors DictationController). */
  cancel: () => void
}

type StartTurnSessionOptions = {
  modelId: string
  registry: JarvisSessionRegistry
  capture: JarvisCaptureControls
  waitForStopped: (sessionId: string) => Promise<void>
  /** Called synchronously so cancel-during-start can reach the handle. */
  register: (handle: JarvisTurnSessionHandle) => void
  onListening: () => void
  onError: (reason: string) => void
  onSettled: () => void
}

/**
 * Starts one manual push-to-talk turn: buffered capture first (worker startup
 * can take seconds and speech during it must not be lost), then the STT
 * session, then the buffer flush. Mirrors DictationController's startup chain
 * including its cancel-during-start unwinding.
 */
export function startJarvisTurnSession(options: StartTurnSessionOptions): void {
  const { registry, capture } = options
  const runId = registry.runId.current + 1
  const sessionId = String(runId)
  registry.runId.current = runId
  registry.kind.current = 'turn'
  registry.sessionId.current = sessionId

  // Why mutable state + synchronous registration: the user can cancel while
  // any await below is pending; each checkpoint re-checks before proceeding.
  let cancelRequested = false
  options.register({
    cancel: () => {
      cancelRequested = true
      capture.stop({ preserveBufferedAudio: true })
    }
  })

  void (async () => {
    let captureStarted = false
    try {
      await capture.start({ bufferAudio: true, sessionId })
      captureStarted = true
      if (cancelRequested || registry.runId.current !== runId) {
        throw new Error('turn-canceled-during-start')
      }
      await window.api.speech.startDictation(options.modelId, undefined, sessionId)
      if (cancelRequested || registry.runId.current !== runId) {
        throw new Error('turn-canceled-during-start')
      }
      await capture.flushBufferedAudio()
      if (cancelRequested || registry.runId.current !== runId) {
        throw new Error('turn-canceled-during-start')
      }
      options.onListening()
    } catch (err) {
      const canceled = err instanceof Error && err.message === 'turn-canceled-during-start'
      await window.api.speech.stopDictation(sessionId).catch(() => undefined)
      await options.waitForStopped(sessionId)
      if (captureStarted) {
        capture.stop()
      }
      capture.discardBufferedAudio()
      if (registry.kind.current === 'turn') {
        registry.kind.current = null
        registry.sessionId.current = null
        registry.grabActive.current = false
      }
      if (canceled) {
        options.onSettled()
      } else {
        options.onError(err instanceof Error ? err.message : String(err))
      }
    }
  })()
}
