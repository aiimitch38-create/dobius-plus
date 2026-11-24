// Why: xterm registers a fresh link entry plus a buffer marker for every OSC 8
// open that has no id=, even when a TUI redraws the same link on the same row.
// Those markers are only freed when the row leaves scrollback, so agents that
// repaint links in place (Claude Code emits id-less OSC 8 under FORCE_HYPERLINK)
// grew the renderer heap by ~2.4 KB per repaint. With an id, xterm keys the link
// by (id, uri) and adds a marker only for a row it has not seen.
const ID_LESS_OSC8_OPEN_PREFIX = '\x1b]8;;'
// eslint-disable-next-line no-control-regex -- matches the OSC 8 introducer; the lookahead skips closes (empty URI)
const ID_LESS_OSC8_OPEN = /\x1b\]8;;(?=[^\x07\x1b])/g
const OSC8_OPEN_WITH_STABLE_ID = '\x1b]8;id=dobius;'

// ponytail: an OSC 8 split across two PTY chunks keeps xterm's old per-open behaviour.
export function withStableOscLinkIds(data: string): string {
  return data.includes(ID_LESS_OSC8_OPEN_PREFIX)
    ? data.replace(ID_LESS_OSC8_OPEN, OSC8_OPEN_WITH_STABLE_ID)
    : data
}
