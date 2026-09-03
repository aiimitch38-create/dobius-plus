/**
 * Unit tests for tauriTeams.ts — the RawTeam <-> AgentTeam wire mapping
 * (`fromRawTeam`) and the connected-accounts source (`listConnectedAccounts`)
 * backing the team account picker.
 *
 * Testing the exported production functions (not local copies), same
 * convention as tauri.test.mjs's fromRawAcpRuntimeCatalogEntry tests.
 */
import assert from "node:assert/strict";
import test from "node:test";

// fromRawTeam/listConnectedAccounts are pure/network-light, but tauriTeams.ts
// transitively imports modules (via tauri.ts) that reference window.setTimeout
// at call time. Install a real-timer window shim before importing, matching
// the convention in tauri.test.mjs / relayRateLimitGate.test.mjs.
globalThis.window = {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
};

const { fromRawTeam, listConnectedAccounts } = await import(
  "./tauriTeams.ts"
);

// ── fromRawTeam: account_ids round-trip ─────────────────────────────────────

function makeRawTeam(overrides = {}) {
  return {
    id: "team-1",
    name: "Engineering Squad",
    description: "Ships the product",
    instructions: null,
    persona_ids: ["persona-1", "persona-2"],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("fromRawTeam maps account_ids to accountIds", () => {
  const raw = makeRawTeam({ account_ids: ["account-uuid-1", "account-uuid-2"] });
  const team = fromRawTeam(raw);
  assert.deepEqual(team.accountIds, ["account-uuid-1", "account-uuid-2"]);
});

test("fromRawTeam defaults accountIds to [] when account_ids is absent (back-compat)", () => {
  const raw = makeRawTeam();
  assert.equal("account_ids" in raw, false);
  const team = fromRawTeam(raw);
  assert.deepEqual(team.accountIds, []);
});

test("fromRawTeam defaults accountIds to [] when account_ids is an empty array", () => {
  const raw = makeRawTeam({ account_ids: [] });
  const team = fromRawTeam(raw);
  assert.deepEqual(team.accountIds, []);
});

test("fromRawTeam still maps every other field correctly alongside accountIds", () => {
  const raw = makeRawTeam({
    account_ids: ["account-uuid-1"],
    is_builtin: true,
    source_dir: "/path/to/team",
    is_symlink: true,
    symlink_target: "/path/to/real-team",
    version: "1.2.3",
  });
  const team = fromRawTeam(raw);
  assert.deepEqual(team, {
    id: "team-1",
    name: "Engineering Squad",
    description: "Ships the product",
    instructions: null,
    personaIds: ["persona-1", "persona-2"],
    accountIds: ["account-uuid-1"],
    isBuiltin: true,
    sourceDir: "/path/to/team",
    isSymlink: true,
    symlinkTarget: "/path/to/real-team",
    version: "1.2.3",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
});

// ── listConnectedAccounts ────────────────────────────────────────────────────

test("listConnectedAccounts returns [] when the Dobius Communications bridge is unavailable", async () => {
  delete globalThis.window.dobiusCommunications;
  const accounts = await listConnectedAccounts();
  assert.deepEqual(accounts, []);
});

test("listConnectedAccounts maps claude/codex accounts.list snapshot to id+label pairs", async () => {
  globalThis.window.dobiusCommunications = {
    invoke: async (command) => {
      assert.equal(command, "accounts.list");
      return {
        ok: true,
        result: {
          claude: {
            accounts: [
              { id: "claude-account-uuid", email: "carson@example.com" },
            ],
          },
          codex: {
            accounts: [{ id: "codex-account-uuid", email: "carson@example.com" }],
          },
        },
      };
    },
  };

  try {
    const accounts = await listConnectedAccounts();
    assert.deepEqual(accounts, [
      { id: "claude-account-uuid", label: "Claude · carson@example.com" },
      { id: "codex-account-uuid", label: "Codex · carson@example.com" },
    ]);
    // Only id + label ever cross this boundary — assert no other keys, so a
    // future edit that starts forwarding extra account fields (which could
    // include something credential-shaped) fails this test immediately.
    for (const account of accounts) {
      assert.deepEqual(Object.keys(account).sort(), ["id", "label"]);
    }
  } finally {
    delete globalThis.window.dobiusCommunications;
  }
});

test("listConnectedAccounts skips entries with no email and drops non-string/missing ids", async () => {
  globalThis.window.dobiusCommunications = {
    invoke: async () => ({
      ok: true,
      result: {
        claude: {
          accounts: [
            { id: "claude-account-uuid" }, // no email
            { email: "no-id@example.com" }, // missing id — dropped
            { id: 42, email: "numeric-id@example.com" }, // non-string id — dropped
          ],
        },
        codex: null, // engine key present but not an object with accounts
      },
    }),
  };

  try {
    const accounts = await listConnectedAccounts();
    assert.deepEqual(accounts, [
      { id: "claude-account-uuid", label: "Claude account" },
    ]);
  } finally {
    delete globalThis.window.dobiusCommunications;
  }
});

test("listConnectedAccounts returns [] when the snapshot itself is malformed", async () => {
  globalThis.window.dobiusCommunications = {
    invoke: async () => ({ ok: true, result: null }),
  };

  try {
    const accounts = await listConnectedAccounts();
    assert.deepEqual(accounts, []);
  } finally {
    delete globalThis.window.dobiusCommunications;
  }
});
