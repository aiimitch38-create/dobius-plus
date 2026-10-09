// Fit-commit completion is injected into XTERM_HTML alongside the fit routine.
export const TERMINAL_FIT_COMMIT_JS = `
  function finishFitCommit() {
    repositionOverlay();
    var callback = fitCommitCallback;
    fitCommitCallback = null;
    if (callback) callback();
    return !!callback;
  }
`
