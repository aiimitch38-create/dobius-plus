import assert from "node:assert/strict";
import test from "node:test";

import { reviveInterruptedChannelRuns } from "./dobiusCommunications.ts";

function interruptedRun(id, sessionKey) {
  return {
    id,
    agentId: "atlas",
    prompt: "ask",
    source: "channel",
    sessionKey,
    status: "error",
    summary: "app restarted during run",
    startedAt: Date.now() - 1_000,
  };
}

test("revives interrupted channel runs but never iMessage runs (N2)", async () => {
  const started = [];
  const storage = new Map();
  const originalError = console.error;
  console.error = () => {};
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    dobiusCommunications: {
      invoke: async (command, args) => {
        if (command === "agent.runs") {
          return {
            ok: true,
            result: {
              runs: [interruptedRun("r-imessage", "imessage"), interruptedRun("r-chan", "chan-1")],
            },
          };
        }
        if (command === "agent.list") {
          return { ok: true, result: { agents: [{ id: "atlas", name: "Atlas" }] } };
        }
        if (command === "agent.run") {
          started.push(args.sessionKey);
        }
        return { ok: false, error: { code: "test", message: "stop here" } };
      },
    },
  };
  try {
    await reviveInterruptedChannelRuns();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(started, ["chan-1"]);
});
