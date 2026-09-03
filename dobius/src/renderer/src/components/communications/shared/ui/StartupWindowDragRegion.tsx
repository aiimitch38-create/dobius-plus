/**
 * Upstream, this component owned the standalone window's title bar: it
 * installed CAPTURE-phase window listeners that started a native drag and
 * called stopImmediatePropagation() for any press in the top 44px that wasn't
 * on an interactive element. Embedded as a Dobius+ tab, the top 44px of the
 * window is Dobius+'s own tab bar — so mounting it made the app's chrome
 * unclickable whenever Communications was open. The Dobius+ window owns
 * dragging; this is deliberately inert. Kept as a component (not deleted)
 * because dozens of screens render it.
 */
export function StartupWindowDragRegion() {
  return null;
}
