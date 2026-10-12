export {
  MOBILE_SNAPSHOT_BYTE_BUDGET,
  TERMINAL_SNAPSHOT_MAX_BYTES
} from '../../shared/terminal-scrollback-limits'

// Why: mobile subscribers hydrate the runtime headless emulator from the
// desktop renderer's xterm buffer. The renderer holds a 50k-row scrollback;
// shipping all of it across IPC + replaying through HeadlessEmulator is
// expensive and unnecessary for a phone screen. Try at most 1000 rows and
// reduce until the soft 512 KiB target is met. See docs/mobile-prefer-renderer-scrollback.md.
export const MOBILE_SUBSCRIBE_SCROLLBACK_ROWS = 1000
