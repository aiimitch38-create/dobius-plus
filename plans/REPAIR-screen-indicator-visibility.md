# Repair: verify the viewing indicator actually became visible

Root cause: `showScreenViewingBanner` awaits loading and calls `showInactive`,
but does not check `isVisible()`. The service's periodic check only checks
`app.isHidden()`. A window that fails to show can therefore leave sharing active
without its local indicator.

Minimal fix: after showing the sandboxed banner, require an actually visible
window. Throw the fixed screen authorization error and destroy it otherwise.

Regression: mock a successfully loaded BrowserWindow whose showInactive does
not make it visible; starting the indicator must reject and destroy the window.
Also cover load rejection, successful showing, Stop, hide and abort teardown.

Rollback: revert only the banner visibility guard, its test and this plan.
