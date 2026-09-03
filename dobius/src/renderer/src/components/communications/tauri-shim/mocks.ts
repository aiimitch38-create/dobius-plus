/** Stand-in for `@tauri-apps/api/mocks`, used only by the tree's own tests. */
export function mockIPC(
  _handler: (command: string, args?: unknown) => unknown,
  _options?: { shouldMockEvents?: boolean }
): void {}
export function mockWindows(_current: string, ..._rest: string[]): void {}
export function clearMocks(): void {}
