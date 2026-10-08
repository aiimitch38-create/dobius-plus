// Keyboard metrics are injected into XTERM_HTML and close over the terminal
// instance and RN message bridge created by the host IIFE.
export const TERMINAL_KEYBOARD_METRICS_JS = `
  var lastEmittedKeyboardMetrics = null;

  function resetKeyboardAvoidanceMetrics() {
    lastEmittedKeyboardMetrics = null;
  }

  // Why: parsed chunks can arrive faster than frames; only cross the RN bridge
  // when keyboard avoidance has a new cursor, row-count, or buffer-mode state.
  function emitKeyboardAvoidanceMetrics() {
    if (!term) return;
    var alt = false;
    try { alt = term.buffer && term.buffer.active && term.buffer.active.type === 'alternate'; } catch (e) {}
    var cursorY = term.buffer && term.buffer.active ? term.buffer.active.cursorY : 0;
    var rows = term.rows || 0;
    var previous = lastEmittedKeyboardMetrics;
    if (previous && previous.cursorY === cursorY && previous.rows === rows && previous.altScreen === alt) return;
    lastEmittedKeyboardMetrics = { cursorY: cursorY, rows: rows, altScreen: alt };
    notify({ type: 'keyboard-avoidance-metrics', cursorY: cursorY, rows: rows, altScreen: alt });
  }
`
