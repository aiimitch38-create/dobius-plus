// Why: PR comments, check logs, commit subjects and file contents can come from
// other people; raw terminal escape codes in them could hide or rewrite what the
// reader (Carson or ADAM) sees. Tabs and newlines are kept.
// oxlint-disable-next-line no-control-regex
const TERMINAL_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

export function safeText(text: string): string {
  return text.replace(TERMINAL_ESCAPE, '').replace(CONTROL_CHARS, '')
}
