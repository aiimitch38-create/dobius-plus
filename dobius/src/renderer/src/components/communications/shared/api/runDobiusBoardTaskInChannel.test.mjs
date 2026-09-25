import assert from "node:assert/strict";
import test from "node:test";

import { runDobiusBoardTaskInChannel } from "./dobiusCommunications.ts";

// #94: the board records the run id on its claim before the run is awaited, so
// main can keep the card running (and record the outcome) if the window goes.
test("hands the run id to the board before waiting on the run", async () => {
  const calls = [];
  globalThis.window = {
    dobiusCommunications: {
      invoke: async (command) => {
        calls.push(command);
        if (command === "agent.list") {
          return { ok: true, result: { agents: [{ id: "atlas", name: "Atlas" }] } };
        }
        if (command === "agent.run") {
          return { ok: true, result: { runId: "r1" } };
        }
        if (command === "agent.runOutbox") {
          return { ok: true, result: { items: [] } };
        }
        if (command === "agent.runs") {
          return {
            ok: true,
            result: { runs: [{ id: "r1", status: "success", summary: "done", costUsd: 0.1 }] },
          };
        }
        return { ok: false, error: { code: "test", message: "not stubbed" } };
      },
    },
  };
  const result = await runDobiusBoardTaskInChannel({
    agentId: "atlas",
    channelId: "chan-1",
    prompt: "p",
    maxBudgetUsd: 3,
    maxTurns: 30,
    onRunStarted: async (runId) => {
      calls.push(`started:${runId}`);
    },
  });
  assert.equal(result.reply, "done");
  assert.ok(calls.indexOf("started:r1") > calls.indexOf("agent.run"));
  assert.ok(calls.indexOf("started:r1") < calls.indexOf("agent.runs"));
});
