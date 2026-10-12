// Replacement xterm surface swap injected into XTERM_HTML.
export const TERMINAL_SURFACE_SWAP_JS = `
  function prepareRetainedSurface(oldSurface) {
    oldSurface.classList.add('terminal-surface');
    oldSurface.style.pointerEvents = 'none';
    oldSurface.removeAttribute('id');
  }

  function abandonPendingSurfaceSwap() {
    if (!pendingSurfaceSwap) return null;
    var previous = pendingSurfaceSwap;
    pendingSurfaceSwap = null;
    disposeTermObservers();
    if (surface && surface !== previous.oldSurface) surface.remove();
    if (term && term !== previous.oldTerm) term.dispose();
    return previous;
  }

  function prepareInitSurface() {
    var previous = abandonPendingSurfaceSwap();
    if (!previous) disposeTermObservers();
    return previous || { oldTerm: term, oldSurface: surface };
  }

  function commitInitSurfaceSwap(gen, nextSurface, oldSurface, oldTerm, cols, rows) {
    if (!pendingSurfaceSwap || pendingSurfaceSwap.gen !== gen) return;
    Object.assign(nextSurface.style, { visibility: 'visible', position: '', left: '', top: '' });
    oldSurface.remove();
    if (oldTerm) oldTerm.dispose();
    if (pendingSurfaceSwap && pendingSurfaceSwap.gen === gen) pendingSurfaceSwap = null;
    notify({ type: 'ready', cols: cols, rows: rows });
  }
`
