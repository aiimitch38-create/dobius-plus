import { useRef, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import type { TerminalOscLinkRange } from './terminal-osc-link-ranges'
import type {
  MobileTerminalTheme,
  TerminalSelectionEvents,
  TerminalWebViewHandle
} from './terminal-webview-contract'
import {
  TerminalWebViewEngineErrorOverlay,
  useTerminalWebViewEngineErrorState
} from './terminal-webview-engine-error-state'
import { TERMINAL_WEBVIEW_FRAME_STYLES } from './terminal-webview-frame-styles'
import { createTerminalWebViewMeasureTracker } from './terminal-webview-measure-tracker'
import { useTerminalWebReadyWatchdog } from './terminal-webview-ready-watchdog'
import { useTerminalWebViewDiagnostics } from './use-terminal-webview-diagnostics'
import { createTerminalWebViewMessageHandler } from './terminal-webview-message-handler'
import { XTERM_WEBVIEW_SOURCE } from './terminal-webview-html'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import { createTerminalWebViewPendingMessages } from './terminal-webview-pending-messages'

export type {
  MobileTerminalTheme,
  TerminalKeyboardAvoidanceMetrics,
  TerminalModes,
  TerminalSelectionEvents,
  TerminalWebViewHandle
} from './terminal-webview-contract'

type Props = {
  style?: StyleProp<ViewStyle>
  terminalTheme?: MobileTerminalTheme
  // Why: baseline zoom multiplier ("text size") applied on top of the fit-to-width
  // scale; raw xterm fontSize can't drive apparent size because the fit cancels it.
  textScale?: number
  diagnosticTerminalKey?: string
  diagnosticActive?: boolean
  diagnosticEnabled?: boolean
  onWebReady?: () => void
  onEngineError?: (message: string) => void
} & TerminalSelectionEvents

export const TerminalWebView = forwardRef<TerminalWebViewHandle, Props>(function TerminalWebView(
  {
    style,
    terminalTheme,
    textScale = 1,
    diagnosticTerminalKey = 'unknown',
    diagnosticActive = false,
    diagnosticEnabled = false,
    onWebReady,
    onEngineError,
    onSelectionMode,
    onSelectionCopy,
    onSelectionEvicted,
    onModesChanged,
    onKeyboardAvoidanceMetrics,
    onHaptic,
    onTerminalInput,
    onTerminalTap,
    onFileTap,
    onOpenUrl,
    onTextScaleChange
  },
  ref
) {
  const webViewRef = useRef<WebView>(null)
  const isWebReadyRef = useRef(false)
  const pendingMessages = useMemo(() => createTerminalWebViewPendingMessages(), [])
  const measureTracker = useMemo(() => createTerminalWebViewMeasureTracker(), [])
  const messageIdRef = useRef(0)
  const terminalThemeKey = useMemo(() => JSON.stringify(terminalTheme ?? null), [terminalTheme])
  // Why: each init() call posts 'init' to the WebView and arms a fresh
  // ready promise. WebView's init() rAF chain ends with a 'ready' notify
  // that resolves it. measureFitDimensions awaits this so it doesn't
  // race ahead of term.open() / renderService population.
  const readyPromiseRef = useRef<Promise<void> | null>(null)
  const readyResolveRef = useRef<(() => void) | null>(null)
  const { clearEngineError, engineError, reportEngineError, reportNativeEngineError } =
    useTerminalWebViewEngineErrorState(onEngineError)
  const {
    handleDiagnosticMessage,
    handleLoadStart: reportLoadStart,
    nativeErrorHandlers,
    reportActiveState,
    reportLifecycleEvent
  } = useTerminalWebViewDiagnostics(
    { terminalKey: diagnosticTerminalKey, active: diagnosticActive, enabled: diagnosticEnabled },
    reportNativeEngineError
  )
  const { armWebReadyWatchdog, clearWebReadyWatchdog } = useTerminalWebReadyWatchdog(
    isWebReadyRef,
    reportEngineError
  )

  const nextMessageId = useCallback(() => {
    messageIdRef.current += 1
    return messageIdRef.current
  }, [])

  const sendToWebView = useCallback(
    (msg: TerminalWebViewCommand, id = nextMessageId()) => {
      webViewRef.current?.postMessage(JSON.stringify({ ...msg, id }))
    },
    [nextMessageId]
  )

  const flushPendingMessages = useCallback(() => {
    pendingMessages.flush(sendToWebView)
  }, [pendingMessages, sendToWebView])

  const postMessage = useCallback(
    (msg: TerminalWebViewCommand) => {
      if (!isWebReadyRef.current) {
        pendingMessages.queue(msg)
        return
      }
      sendToWebView(msg)
    },
    [pendingMessages, sendToWebView]
  )

  const handleMessage = useMemo(
    () =>
      createTerminalWebViewMessageHandler({
        isWebReadyRef,
        readyPromiseRef,
        readyResolveRef,
        measureTracker,
        clearEngineError,
        clearWebReadyWatchdog,
        flushPendingMessages,
        onWebReady,
        onSelectionMode,
        onSelectionCopy,
        onSelectionEvicted,
        onModesChanged,
        onKeyboardAvoidanceMetrics,
        onHaptic,
        onTerminalInput,
        onTerminalTap,
        onFileTap,
        onOpenUrl,
        onTextScaleChange,
        postMessage,
        reportEngineError,
        reportLifecycleEvent,
        reportActiveState,
        handleDiagnosticMessage
      }),
    [
      clearEngineError,
      clearWebReadyWatchdog,
      flushPendingMessages,
      handleDiagnosticMessage,
      measureTracker,
      onFileTap,
      onHaptic,
      onKeyboardAvoidanceMetrics,
      onModesChanged,
      onOpenUrl,
      onSelectionCopy,
      onSelectionEvicted,
      onSelectionMode,
      onTerminalInput,
      onTerminalTap,
      onTextScaleChange,
      onWebReady,
      postMessage,
      reportActiveState,
      reportEngineError,
      reportLifecycleEvent
    ]
  )

  const handleLoadStart = useCallback(() => {
    reportLoadStart()
    isWebReadyRef.current = false
    armWebReadyWatchdog()
    // Why: messages queued for a previous WebView generation are stale after a reload;
    // dropping them avoids replaying terminal chunks before the next init snapshot.
    pendingMessages.clear()
  }, [armWebReadyWatchdog, pendingMessages, reportLoadStart])

  const handleReload = useCallback(() => {
    reportLifecycleEvent('reload-requested')
    clearEngineError()
    webViewRef.current?.reload()
  }, [clearEngineError, reportLifecycleEvent])

  useEffect(() => {
    postMessage({ type: 'set-theme', terminalTheme })
  }, [postMessage, terminalThemeKey, terminalTheme])

  useEffect(() => {
    reportActiveState(postMessage)
  }, [postMessage, reportActiveState])

  // Why: live-apply text-size changes to an already-mounted terminal (the pane
  // stays alive while the user visits Settings), so no terminal reload is needed.
  useEffect(() => {
    postMessage({ type: 'set-font-scale', fontScale: textScale })
  }, [postMessage, textScale])

  useEffect(() => () => measureTracker.clear(), [measureTracker])

  useImperativeHandle(
    ref,
    () => ({
      write(data: string) {
        postMessage({ type: 'write', data })
      },
      init(
        cols: number,
        rows: number,
        initialData?: string,
        preserveScroll?: boolean,
        oscLinks?: TerminalOscLinkRange[]
      ) {
        // Why: arm a fresh ready promise BEFORE posting init. The WebView
        // resolves it via the 'ready' notify at the end of its rAF chain.
        // Resolve any prior in-flight ready first so awaiters from the
        // previous generation don't sit on the 3s setTimeout fallback —
        // each leaked timer + closure pinned an awaiting measure caller
        // for the full 3s under rapid re-init (orientation change,
        // multiple resubscribes), delaying cold-start fit chains.
        const priorResolve = readyResolveRef.current
        if (priorResolve) {
          readyResolveRef.current = null
          readyPromiseRef.current = null
          priorResolve()
        }
        readyPromiseRef.current = new Promise<void>((resolve) => {
          readyResolveRef.current = resolve
        })
        postMessage({
          type: 'init',
          cols,
          rows,
          initialData,
          oscLinks,
          terminalTheme,
          fontScale: textScale,
          preserveScroll
        })
      },
      resize(cols: number, rows: number) {
        postMessage({ type: 'resize', cols, rows })
      },
      reflow(cols: number, rows: number) {
        postMessage({ type: 'reflow', cols, rows })
      },
      clear() {
        postMessage({ type: 'clear' })
      },
      measureFitDimensions(
        containerHeight?: number
      ): Promise<{ cols: number; rows: number } | null> {
        if (!isWebReadyRef.current) {
          return Promise.resolve(null)
        }
        return new Promise((resolve) => {
          const id = nextMessageId()
          let timeout: ReturnType<typeof setTimeout> | null = null
          const finish = (result: { cols: number; rows: number } | null) => {
            if (timeout) {
              clearTimeout(timeout)
              timeout = null
            }
            resolve(result)
          }
          measureTracker.replace(id, finish)
          // Why: if the WebView doesn't respond within 2s (e.g., xterm
          // failed to load), resolve null so the caller can disable
          // Fit to Phone rather than hanging indefinitely.
          timeout = setTimeout(() => {
            measureTracker.cancel(id)
          }, 2000)
          sendToWebView({ type: 'measure', containerHeight }, id)
        })
      },
      resetZoom() {
        postMessage({ type: 'reset-zoom' })
      },
      cancelSelect() {
        postMessage({ type: 'cancel-select' })
      },
      doSelectAll() {
        postMessage({ type: 'do-select-all' })
      },
      async awaitReady(): Promise<void> {
        // Why: returns the in-flight ready promise (set by init); resolves
        // immediately if no init is pending. Capped at 3s so a stuck
        // WebView doesn't hang the caller.
        const p = readyPromiseRef.current
        if (!p) {
          return
        }
        await new Promise<void>((resolve) => {
          let settled = false
          const timeout = setTimeout(() => {
            settled = true
            resolve()
          }, 3000)
          void p.finally(() => {
            if (!settled) {
              clearTimeout(timeout)
              settled = true
              resolve()
            }
          })
        })
      }
    }),
    [measureTracker, nextMessageId, postMessage, sendToWebView, terminalTheme, textScale]
  )

  return (
    <View style={[TERMINAL_WEBVIEW_FRAME_STYLES.container, style]}>
      <WebView
        ref={webViewRef}
        source={XTERM_WEBVIEW_SOURCE}
        style={TERMINAL_WEBVIEW_FRAME_STYLES.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        // Why: Android parent gesture containers can intercept vertical drags
        // before the injected xterm scroll router sees them.
        nestedScrollEnabled
        scalesPageToFit={false}
        // Why: Android WebView defaults textZoom to the system font scale, inflating
        // xterm's DOM glyphs past its canvas-measured cell grid (#4579). iOS ignores it.
        textZoom={100}
        onLoadStart={handleLoadStart}
        onMessage={handleMessage}
        onError={nativeErrorHandlers.onLoadError}
        onHttpError={nativeErrorHandlers.onHttpError}
        onRenderProcessGone={nativeErrorHandlers.onRenderProcessGone}
        onContentProcessDidTerminate={nativeErrorHandlers.onContentProcessDidTerminate}
      />
      {engineError ? (
        <TerminalWebViewEngineErrorOverlay message={engineError} onReload={handleReload} />
      ) : null}
    </View>
  )
})
