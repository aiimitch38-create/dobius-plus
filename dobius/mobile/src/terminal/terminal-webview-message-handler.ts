import type { WebViewMessageEvent } from 'react-native-webview'
import type {
  TerminalKeyboardAvoidanceMetrics,
  TerminalModes,
  TerminalSelectionEvents
} from './terminal-webview-contract'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import type { createTerminalWebViewMeasureTracker } from './terminal-webview-measure-tracker'
import type { TerminalWebViewLifecycleEvent } from './terminal-webview-lifecycle-diagnostics'

type MessageHandlerOptions = TerminalSelectionEvents & {
  isWebReadyRef: { current: boolean }
  readyPromiseRef: { current: Promise<void> | null }
  readyResolveRef: { current: (() => void) | null }
  measureTracker: ReturnType<typeof createTerminalWebViewMeasureTracker>
  clearEngineError: () => void
  clearWebReadyWatchdog: () => void
  flushPendingMessages: () => void
  onWebReady?: () => void
  onFileTap?: (pathText: string, line: number | null, column: number | null) => void
  onOpenUrl?: (url: string) => void
  onTextScaleChange?: (scale: number) => void
  postMessage: (message: TerminalWebViewCommand) => void
  reportEngineError: (message: string, fatal: boolean) => void
  reportLifecycleEvent: (event: TerminalWebViewLifecycleEvent) => void
  reportActiveState: (post: (message: TerminalWebViewCommand) => void) => void
  handleDiagnosticMessage: (message: unknown) => boolean
}

export function createTerminalWebViewMessageHandler(options: MessageHandlerOptions) {
  return (event: WebViewMessageEvent): void => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
    } catch {
      return
    }

    if (message.type === 'web-ready') {
      options.reportLifecycleEvent('web-ready')
      options.isWebReadyRef.current = true
      options.clearWebReadyWatchdog()
      options.clearEngineError()
      options.reportActiveState(options.postMessage)
      options.onWebReady?.()
      options.flushPendingMessages()
    } else if (message.type === 'ready') {
      const resolve = options.readyResolveRef.current
      options.readyResolveRef.current = null
      options.readyPromiseRef.current = null
      resolve?.()
    } else if (message.type === 'measure-result') {
      const cols = typeof message.cols === 'number' ? message.cols : null
      const rows = typeof message.rows === 'number' ? message.rows : null
      options.measureTracker.resolve(
        message.id,
        cols && rows && cols >= 20 && rows >= 8 ? { cols, rows } : null
      )
    } else if (message.type === 'log') {
      const tag = typeof message.tag === 'string' ? message.tag : '[fit]'
      // eslint-disable-next-line no-console
      console.log(tag, message.payload)
    } else if (message.type === 'geometry-probe') {
      options.handleDiagnosticMessage(message)
    } else if (message.type === 'error') {
      const text = typeof message.message === 'string' ? message.message : 'Unknown terminal error'
      options.reportEngineError(text, message.fatal !== false)
    } else if (message.type === 'set-select-mode') {
      options.onSelectionMode?.(!!message.enabled)
    } else if (message.type === 'selection') {
      const text = typeof message.text === 'string' ? message.text : ''
      options.onSelectionCopy?.(text)
    } else if (message.type === 'selection-evicted') {
      options.onSelectionEvicted?.()
    } else if (message.type === 'modes') {
      const mouseTrackingMode =
        message.mouseTrackingMode === 'x10' ||
        message.mouseTrackingMode === 'vt200' ||
        message.mouseTrackingMode === 'drag' ||
        message.mouseTrackingMode === 'any'
          ? message.mouseTrackingMode
          : 'none'
      const modes: TerminalModes = {
        bracketedPasteMode: !!message.bracketedPasteMode,
        altScreen: !!message.altScreen,
        mouseTrackingMode,
        sgrMouseMode: !!message.sgrMouseMode,
        sgrMousePixelsMode: !!message.sgrMousePixelsMode
      }
      options.onModesChanged?.(modes)
    } else if (message.type === 'terminal-input') {
      const bytes = typeof message.bytes === 'string' ? message.bytes : ''
      if (bytes.length > 0) {
        options.onTerminalInput?.(bytes)
      }
    } else if (message.type === 'terminal-tap') {
      options.onTerminalTap?.()
    } else if (message.type === 'terminal-file-tap') {
      const pathText = typeof message.pathText === 'string' ? message.pathText : ''
      if (pathText.length > 0) {
        const line = typeof message.line === 'number' ? message.line : null
        const column = typeof message.column === 'number' ? message.column : null
        options.onFileTap?.(pathText, line, column)
      }
    } else if (message.type === 'open-url') {
      const url = typeof message.url === 'string' ? message.url : ''
      if (url.length > 0) {
        options.onOpenUrl?.(url)
      }
    } else if (message.type === 'keyboard-avoidance-metrics') {
      const metrics: TerminalKeyboardAvoidanceMetrics = {
        cursorY: typeof message.cursorY === 'number' ? message.cursorY : 0,
        rows: typeof message.rows === 'number' ? message.rows : 0,
        altScreen: !!message.altScreen
      }
      options.onKeyboardAvoidanceMetrics?.(metrics)
    } else if (message.type === 'haptic') {
      const kind = message.kind
      if (kind === 'selection' || kind === 'success' || kind === 'error' || kind === 'edge-bump') {
        options.onHaptic?.(kind)
      }
    } else if (message.type === 'font-scale-changed') {
      const scale = typeof message.fontScale === 'number' ? message.fontScale : 0
      if (scale > 0) {
        options.onTextScaleChange?.(scale)
      }
    } else if (message.type === 'mobile-clip-cancel-by-pinch') {
      // eslint-disable-next-line no-console
      console.warn('[mobile-clip] selection cancelled by pinch')
    }
  }
}
