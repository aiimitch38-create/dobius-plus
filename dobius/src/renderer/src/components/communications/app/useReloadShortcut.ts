import * as React from "react";

/**
 * Cmd+R inside Communications.
 *
 * Upstream reloaded the webview here, because the client owned the window.
 * Embedded in a Dobius+ tab, `window.location.reload()` reloads the entire
 * app — every terminal, every session — so this deliberately does nothing but
 * swallow the keystroke, which stops the browser default doing exactly that.
 *
 * If a Communications-only refresh is ever wanted, it needs to remount this
 * subtree (a key change on CommunicationsPage), not touch window.location.
 */
export function useReloadShortcut() {
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "r"
      ) {
        return;
      }
      event.preventDefault();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
