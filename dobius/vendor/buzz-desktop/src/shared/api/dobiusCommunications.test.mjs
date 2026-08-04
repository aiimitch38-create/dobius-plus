import assert from "node:assert/strict";
import test from "node:test";

import { hexToBytes } from "@noble/hashes/utils.js";
import { getPublicKey } from "nostr-tools/pure";

import {
  collectionSize,
  invokeDobiusRuntime,
  invokeDobiusBackedTauriCommand,
  loadDobiusManagedAgents,
  loadDobiusPersonas,
  loadDobiusWorkstationSnapshot,
} from "./dobiusCommunications.ts";

test("invokes the isolated Dobius bridge and unwraps successful results", async () => {
  globalThis.window = {
    dobiusCommunications: {
      invoke: async (_command, _args) => ({
        version: 1,
        id: "request-1",
        ok: true,
        result: { agents: [{ id: "adam" }] },
      }),
    },
  };

  assert.deepEqual(await invokeDobiusRuntime("agent.list"), {
    agents: [{ id: "adam" }],
  });
});

test("surfaces bridge failures instead of silently using mock data", async () => {
  globalThis.window = {
    dobiusCommunications: {
      invoke: async () => ({
        version: 1,
        id: "request-2",
        ok: false,
        error: { code: "denied", message: "No access" },
      }),
    },
  };

  await assert.rejects(
    invokeDobiusRuntime("agent.list"),
    /denied: No access/,
  );
});

test("loads a workstation snapshot from the six real runtime projections", async () => {
  const calls = [];
  globalThis.window = {
    dobiusCommunications: {
      invoke: async (command, args) => {
        calls.push([command, args]);
        return { version: 1, id: command, ok: true, result: command };
      },
    },
  };

  const snapshot = await loadDobiusWorkstationSnapshot();
  assert.equal(snapshot.agents, "agent.list");
  assert.deepEqual(snapshot.errors, {});
  assert.deepEqual(
    calls.map(([command]) => command),
    [
      "accounts.list",
      "agent.list",
      "repo.list",
      "status.get",
      "terminal.list",
      "worktree.ps",
    ],
  );
});

test("returns a degraded snapshot instead of loading forever", async () => {
  globalThis.window = {
    dobiusCommunications: {
      invoke: async (command) => {
        if (command === "accounts.list") return new Promise(() => {});
        return { version: 1, id: command, ok: true, result: command };
      },
    },
  };

  const snapshot = await loadDobiusWorkstationSnapshot(20);
  assert.equal(snapshot.repos, "repo.list");
  assert.equal(snapshot.accounts, null);
  assert.match(snapshot.errors.accounts, /timed out/);
});

test("counts direct and named collections without guessing object size", () => {
  assert.equal(collectionSize([1, 2], []), 2);
  assert.equal(collectionSize({ agents: [{}, {}, {}] }, ["agents"]), 3);
  assert.equal(collectionSize({ unrelated: [] }, ["agents"]), 0);
});

test("projects only real Dobius agents and their run state into Buzz records", async () => {
  const storage = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    dobiusCommunications: {
      invoke: async (command) => ({
        version: 1,
        id: command,
        ok: true,
        result:
          command === "agent.list"
            ? {
                agents: [
                  {
                    id: "agent-adam",
                    name: "ADAM",
                    model: "claude-opus",
                    createdAt: 10,
                    updatedAt: 20,
                  },
                ],
              }
            : { runs: [{ agentId: "agent-adam", status: "running" }] },
      }),
    },
  };

  const [agent] = await loadDobiusManagedAgents();
  assert.equal(agent.name, "ADAM");
  assert.equal(agent.status, "running");
  assert.equal(agent.backend_agent_id, "agent-adam");
  assert.match(agent.pubkey, /^[a-f0-9]{64}$/);
});

test("maps Buzz managed-agent start and stop onto Dobius on-demand lifecycle", async () => {
  const identity = {
    privateKey: "16".repeat(32),
    pubkey: "17".repeat(32),
    username: "Dobius User",
  };
  const storage = new Map([["dobius-buzz-identity.v1", JSON.stringify(identity)]]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    dobiusCommunications: {
      invoke: async (command) => ({
        version: 1,
        id: command,
        ok: true,
        result: command === "agent.list"
          ? { agents: [{ id: "adam", name: "Adam", model: "claude" }] }
          : { runs: [] },
      }),
    },
  };
  const [agent] = await loadDobiusManagedAgents();

  const started = await invokeDobiusBackedTauriCommand("start_managed_agent", {
    pubkey: agent.pubkey,
  });
  const stopped = await invokeDobiusBackedTauriCommand("stop_managed_agent", {
    pubkey: agent.pubkey,
  });

  assert.equal(started.handled, true);
  assert.equal(started.result.status, "running");
  assert.equal(stopped.handled, true);
  assert.equal(stopped.result.status, "stopped");
});

test("projects Dobius agent definitions as Buzz personas", async () => {
  globalThis.window = {
    dobiusCommunications: {
      invoke: async (command) => ({
        version: 1,
        id: command,
        ok: true,
        result: {
          agents: [
            {
              id: "agent-reviewer",
              name: "Reviewer",
              systemPrompt: "Review every change.",
              model: "codex",
            },
          ],
        },
      }),
    },
  };

  const [persona] = await loadDobiusPersonas();
  assert.equal(persona.id, "agent-reviewer");
  assert.equal(persona.display_name, "Reviewer");
  assert.equal(persona.system_prompt, "Review every change.");
  assert.equal(persona.runtime, "dobius-native:claude:active");
});

test("blocks upstream persona and team fixtures in the Dobius embed", async () => {
  globalThis.window = {
    dobiusCommunications: {
      invoke: async (command) => ({
        version: 1,
        id: command,
        ok: true,
        result: { agents: [], runs: [] },
      }),
    },
  };

  assert.deepEqual(await invokeDobiusBackedTauriCommand("list_personas"), {
    handled: true,
    result: [],
  });
  assert.deepEqual(await invokeDobiusBackedTauriCommand("list_teams"), {
    handled: true,
    result: [],
  });
});

test("routes Buzz persona creation into the real Dobius agent store", async () => {
  const calls = [];
  globalThis.window = {
    dobiusCommunications: {
      invoke: async (command, args) => {
        calls.push([command, args]);
        return {
          version: 1,
          id: command,
          ok: true,
          result: {
            agent: {
              id: "agent-builder",
              name: args.name,
              systemPrompt: args.systemPrompt,
              engine: args.engine,
              accountId: args.accountId,
              model: args.model,
              createdAt: 100,
              updatedAt: 100,
            },
          },
        };
      },
    },
  };

  const result = await invokeDobiusBackedTauriCommand("create_persona", {
    input: {
      displayName: "Builder",
      systemPrompt: "Build and verify.",
      runtime: "dobius-native:claude:claude-account-1",
      model: "codex",
    },
  });

  assert.deepEqual(calls, [
    [
      "agent.create",
      {
        name: "Builder",
        systemPrompt: "Build and verify.",
        engine: "claude",
        accountId: "claude-account-1",
        model: "codex",
      },
    ],
  ]);
  assert.equal(result.handled, true);
  assert.equal(result.result.display_name, "Builder");
  assert.equal(result.result.runtime, "dobius-native:claude:claude-account-1");
});

test("advertises Dobius as the only embedded agent runtime", async () => {
  globalThis.window = {
    dobiusCommunications: {
      invoke: async (command) => ({
        version: 1,
        id: command,
        ok: true,
        result: {
          claude: { accounts: [{ id: "claude-1", email: "claude@example.com" }] },
          codex: { accounts: [{ id: "codex-1", email: "codex@example.com" }] },
        },
      }),
    },
  };

  const result = await invokeDobiusBackedTauriCommand("discover_acp_providers");
  assert.equal(result.handled, true);
  assert.deepEqual(
    result.result.map((runtime) => [runtime.id, runtime.label, runtime.availability]),
    [
      ["dobius-native:claude:claude-1", "Claude SDK · claude@example.com", "available"],
      ["dobius-native:codex:codex-1", "Codex · codex@example.com", "available"],
    ],
  );
});

test("accepts only the canonical local Communications relay authority", async () => {
  globalThis.window = {
    dobiusCommunications: {
      invoke: async () => {
        throw new Error("workspace selection must remain renderer-local");
      },
    },
  };

  assert.deepEqual(
    await invokeDobiusBackedTauriCommand("apply_workspace", {
      relayUrl: "ws://localhost:3300",
    }),
    { handled: true, result: undefined },
  );
  await assert.rejects(
    invokeDobiusBackedTauriCommand("apply_workspace", {
      relayUrl: "ws://127.0.0.1:3300",
    }),
    /requires ws:\/\/localhost:3300/,
  );
});

test("reads the signed local profile from the real relay surface", async () => {
  const identity = {
    privateKey: "01".repeat(32),
    pubkey: "02".repeat(32),
    username: "Dobius User",
  };
  globalThis.window = {
    localStorage: {
      getItem: () => JSON.stringify(identity),
    },
    dobiusCommunications: { invoke: async () => ({ ok: true, result: null }) },
  };
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.headers["X-Pubkey"], identity.pubkey);
    return {
      ok: true,
      json: async () => [
        {
          id: "profile-1",
          pubkey: identity.pubkey,
          created_at: 10,
          kind: 0,
          tags: [],
          content: JSON.stringify({ display_name: "Bayou", about: "Builder" }),
        },
      ],
    };
  };

  const response = await invokeDobiusBackedTauriCommand("get_profile");
  assert.equal(response.handled, true);
  assert.equal(response.result.display_name, "Bayou");
  assert.equal(response.result.about, "Builder");
  assert.equal(response.result.has_profile_event, true);
});

test("merges and publishes profile updates as a signed kind-zero event", async () => {
  const identity = {
    privateKey: "03".repeat(32),
    pubkey: "04".repeat(32),
    username: "Dobius User",
  };
  globalThis.window = {
    localStorage: {
      getItem: () => JSON.stringify(identity),
    },
    dobiusCommunications: { invoke: async () => ({ ok: true, result: null }) },
  };
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([url, init]);
    if (url.endsWith("/query")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "profile-1",
            pubkey: identity.pubkey,
            created_at: 10,
            kind: 0,
            tags: [],
            content: JSON.stringify({ display_name: "Old", about: "Kept" }),
          },
        ],
      };
    }
    return { ok: true, text: async () => "" };
  };

  const response = await invokeDobiusBackedTauriCommand("update_profile", {
    displayName: "New Name",
  });
  assert.equal(response.handled, true);
  assert.equal(response.result.display_name, "New Name");
  assert.equal(response.result.about, "Kept");
  const submitted = JSON.parse(requests[1][1].body);
  assert.equal(submitted.kind, 0);
  assert.equal(JSON.parse(submitted.content).about, "Kept");
  assert.equal(JSON.parse(submitted.content).display_name, "New Name");
});

test("allows an empty user query for the DM picker initial page", async () => {
  const identity = {
    privateKey: "05".repeat(32),
    pubkey: "06".repeat(32),
    username: "Dobius User",
  };
  globalThis.window = {
    localStorage: { getItem: () => JSON.stringify(identity) },
    dobiusCommunications: { invoke: async () => ({ ok: true, result: null }) },
  };
  let submittedFilter;
  globalThis.fetch = async (_url, init) => {
    submittedFilter = JSON.parse(init.body)[0];
    return { ok: true, json: async () => [] };
  };

  const response = await invokeDobiusBackedTauriCommand("search_users", {
    query: "",
    limit: 8,
    cursor: null,
  });
  assert.equal(response.handled, true);
  assert.deepEqual(response.result, { users: [], next_cursor: null });
  assert.deepEqual(submittedFilter, { kinds: [0], limit: 8, page: 1 });
});

test("opens a real relay DM and returns the channel shape expected by Buzz", async () => {
  const identity = {
    privateKey: "07".repeat(32),
    pubkey: "08".repeat(32),
    username: "Dobius User",
  };
  const otherPubkey = "09".repeat(32);
  globalThis.window = {
    localStorage: { getItem: () => JSON.stringify(identity) },
    dobiusCommunications: { invoke: async () => ({ ok: true, result: null }) },
  };
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([url, init]);
    if (url.endsWith("/events")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            accepted: true,
            message: 'response:{"channel_id":"dm-channel","created":true}',
          }),
      };
    }
    return {
      ok: true,
      json: async () => [
        {
          id: "dm-meta",
          pubkey: identity.pubkey,
          created_at: 20,
          kind: 39000,
          tags: [
            ["d", "dm-channel"],
            ["name", "DM"],
            ["t", "dm"],
            ["p", identity.pubkey],
            ["p", otherPubkey],
          ],
          content: "",
        },
      ],
    };
  };

  const response = await invokeDobiusBackedTauriCommand("open_dm", {
    pubkeys: [otherPubkey],
  });
  assert.equal(response.handled, true);
  assert.equal(response.result.id, "dm-channel");
  assert.equal(response.result.channel_type, "dm");
  assert.deepEqual(response.result.participant_pubkeys, [identity.pubkey, otherPubkey]);
  const event = JSON.parse(requests[0][1].body);
  assert.equal(event.kind, 41010);
  assert.deepEqual(event.tags, [["p", otherPubkey]]);
});

test("returns real channel members and identifies native Dobius agents", async () => {
  const identity = {
    privateKey: "14".repeat(32),
    pubkey: "15".repeat(32),
    username: "Dobius User",
  };
  const storage = new Map([["dobius-buzz-identity.v1", JSON.stringify(identity)]]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    dobiusCommunications: {
      invoke: async (command) => ({
        version: 1,
        id: command,
        ok: true,
        result: { agents: [{ id: "adam", name: "Adam", model: "claude" }] },
      }),
    },
  };
  const [agent] = await loadDobiusManagedAgents();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [{
      id: "membership",
      pubkey: identity.pubkey,
      created_at: 10,
      kind: 39002,
      tags: [["d", "dm-adam"], ["p", identity.pubkey, "owner"], ["p", agent.pubkey, "bot"]],
      content: "",
    }],
  });

  const response = await invokeDobiusBackedTauriCommand("get_channel_members", {
    channelId: "dm-adam",
  });

  assert.equal(response.handled, true);
  assert.equal(response.result.members.length, 2);
  assert.deepEqual(response.result.members[1], {
    pubkey: agent.pubkey,
    role: "bot",
    is_agent: true,
    joined_at: new Date(10_000).toISOString(),
    display_name: "Adam",
  });
});

test("sends a signed channel message through the real relay", async () => {
  const identity = {
    privateKey: "0a".repeat(32),
    pubkey: "0b".repeat(32),
    username: "Dobius User",
  };
  const mentionedPubkey = "0c".repeat(32);
  globalThis.window = {
    localStorage: { getItem: () => JSON.stringify(identity) },
    dobiusCommunications: { invoke: async () => ({ ok: true, result: null }) },
  };
  let submitted;
  globalThis.fetch = async (url, init) => {
    assert.ok(url.endsWith("/events"));
    submitted = JSON.parse(init.body);
    return {
      ok: true,
      text: async () => JSON.stringify({ accepted: true, event_id: submitted.id }),
    };
  };

  const response = await invokeDobiusBackedTauriCommand("send_channel_message", {
    channelId: "dm-channel",
    content: "  hello  ",
    mentionPubkeys: [mentionedPubkey],
  });

  assert.equal(response.handled, true);
  assert.equal(response.result.event_id, submitted.id);
  assert.equal(response.result.parent_event_id, null);
  assert.equal(response.result.root_event_id, null);
  assert.equal(response.result.depth, 0);
  assert.equal(submitted.kind, 9);
  assert.equal(submitted.content, "hello");
  assert.deepEqual(submitted.tags, [
    ["h", "dm-channel"],
    ["p", mentionedPubkey],
  ]);
});

test("dispatches a room message to the matching native Dobius agent and posts its reply", async () => {
  const identity = {
    privateKey: "0d".repeat(32),
    pubkey: "0e".repeat(32),
    username: "Dobius User",
  };
  const storage = new Map([["dobius-buzz-identity.v1", JSON.stringify(identity)]]);
  const calls = [];
  globalThis.window = {
    setTimeout,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    dobiusCommunications: {
      invoke: async (command, args) => {
        calls.push([command, args]);
        if (command === "agent.list") {
          return {
            version: 1,
            id: command,
            ok: true,
            result: { agents: [{ id: "native-agent", name: "Builder", model: "claude" }] },
          };
        }
        if (command === "agent.runs") {
          return {
            version: 1,
            id: command,
            ok: true,
            result: {
              runs: [{ id: "run-1", agentId: "native-agent", status: "success", summary: "Done." }],
            },
          };
        }
        return { version: 1, id: command, ok: true, result: { runId: "run-1", runs: [] } };
      },
    },
  };
  const [agent] = await loadDobiusManagedAgents();
  const submittedEvents = [];
  globalThis.fetch = async (url, init) => {
    if (url.endsWith("/query")) {
      return {
        ok: true,
        json: async () => [{
          id: "dm-metadata",
          pubkey: identity.pubkey,
          created_at: 1,
          kind: 39000,
          tags: [["d", "agent-room"], ["p", identity.pubkey], ["p", agent.pubkey]],
          content: "",
        }],
      };
    }
    const event = JSON.parse(init.body);
    submittedEvents.push(event);
    return {
      ok: true,
      text: async () => JSON.stringify({ accepted: true, event_id: event.id }),
    };
  };

  await invokeDobiusBackedTauriCommand("send_channel_message", {
    channelId: "agent-room",
    content: "Do the task",
  });
  for (let attempt = 0; attempt < 20 && submittedEvents.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(calls.filter(([command]) => command === "agent.run"), [
    ["agent.run", { id: "native-agent", prompt: "Do the task" }],
  ]);
  assert.equal(submittedEvents.length, 2);
  assert.equal(submittedEvents[1].content, "Done.");
  assert.equal(submittedEvents[1].pubkey, agent.pubkey);
  assert.deepEqual(submittedEvents[1].tags, [
    ["h", "agent-room"],
    ["p", identity.pubkey],
    ["e", submittedEvents[0].id, "", "reply"],
  ]);
});

// A minimal in-memory relay: /events persists the signed event it receives,
// /query filters that store by kind/#tag/ids, matching the real relay's
// contract closely enough to catch payload-shape bugs (unwrapping,
// tag naming) that a hardcoded fixture per test would hide.
//
// The identity's pubkey must be the real secp256k1 public key for the given
// private key: `finalizeEvent` (used by the code under test) derives each
// signed event's `.pubkey` from the private key, not from any declared
// value, so a mismatched pair makes membership/ownership checks fail in
// ways that have nothing to do with the code being tested.
function installFakeRelay(privateKeyHex, username = "Owner") {
  const identity = {
    privateKey: privateKeyHex,
    pubkey: getPublicKey(hexToBytes(privateKeyHex)),
    username,
  };
  const storage = new Map([["dobius-buzz-identity.v1", JSON.stringify(identity)]]);
  const events = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    dobiusCommunications: { invoke: async () => ({ ok: true, result: null }) },
  };
  globalThis.fetch = async (url, init) => {
    if (url.endsWith("/events")) {
      const event = JSON.parse(init.body);
      // NIP-33: an addressable event (kind 30000-39999) replaces any prior
      // event with the same (kind, pubkey, d-tag) rather than coexisting
      // with it. Without this, two updates issued within the same wall-clock
      // second tie on created_at and "pick the latest" becomes ambiguous.
      if (event.kind >= 30000 && event.kind < 40000) {
        const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
        const priorIndex = events.findIndex(
          (stored) => stored.kind === event.kind && stored.pubkey === event.pubkey &&
            stored.tags.find((tag) => tag[0] === "d")?.[1] === dTag,
        );
        if (priorIndex !== -1) events.splice(priorIndex, 1);
      }
      events.push(event);
      return { ok: true, text: async () => JSON.stringify({ accepted: true, event_id: event.id }) };
    }
    const [filter] = JSON.parse(init.body);
    const matches = events.filter((event) => {
      if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
      if (filter.ids && !filter.ids.includes(event.id)) return false;
      if (typeof filter.until === "number" && event.created_at > filter.until) return false;
      for (const key of Object.keys(filter)) {
        if (!key.startsWith("#")) continue;
        const tagName = key.slice(1);
        const wanted = filter[key];
        if (!event.tags.some((tag) => tag[0] === tagName && wanted.includes(tag[1]))) return false;
      }
      return true;
    });
    return { ok: true, json: async () => matches };
  };
  return { identity, events };
}

test("creates a channel and returns full channel-detail fields, including membership", async () => {
  const { identity } = installFakeRelay("20".repeat(32));

  const response = await invokeDobiusBackedTauriCommand("create_channel", {
    name: "Engineering",
    channelType: "stream",
    visibility: "open",
    description: "Build stuff",
  });

  assert.equal(response.handled, true);
  assert.equal(response.result.name, "Engineering");
  assert.equal(response.result.description, "Build stuff");
  assert.equal(response.result.visibility, "open");
  assert.equal(response.result.created_by, identity.pubkey);
  assert.deepEqual(response.result.member_pubkeys, [identity.pubkey]);
  assert.equal(response.result.is_member, true);
  assert.match(response.result.id, /^engineering-[0-9a-f]{8}$/);
});

test("update_channel unwraps its { input } payload instead of reading it flat", async () => {
  installFakeRelay("22".repeat(32));

  const created = await invokeDobiusBackedTauriCommand("create_channel", {
    name: "Design",
    channelType: "stream",
    visibility: "open",
  });
  const channelId = created.result.id;

  const updated = await invokeDobiusBackedTauriCommand("update_channel", {
    input: { channelId, description: "New description" },
  });

  assert.equal(updated.handled, true);
  assert.equal(updated.result.description, "New description");
  assert.equal(updated.result.name, "Design", "unrelated fields must be preserved across an update");
});

test("set_channel_topic accepts its flat payload and does not require a { input } wrapper", async () => {
  installFakeRelay("24".repeat(32));

  const created = await invokeDobiusBackedTauriCommand("create_channel", {
    name: "Support",
    channelType: "stream",
    visibility: "open",
  });
  const channelId = created.result.id;

  const response = await invokeDobiusBackedTauriCommand("set_channel_topic", {
    channelId,
    topic: "On-call rotation",
  });
  assert.equal(response.handled, true);
  assert.equal(response.result, undefined, "set_channel_topic's contract is Promise<void>");

  const details = await invokeDobiusBackedTauriCommand("get_channel_details", { channelId });
  assert.equal(details.result.topic, "On-call rotation");
});

test("join_channel adds the local identity to membership and archive/unarchive round-trips", async () => {
  installFakeRelay("26".repeat(32));

  const created = await invokeDobiusBackedTauriCommand("create_channel", {
    name: "General",
    channelId: "general",
    channelType: "stream",
    visibility: "open",
  });
  await invokeDobiusBackedTauriCommand("leave_channel", { channelId: "general" });
  const afterLeave = await invokeDobiusBackedTauriCommand("get_channel_details", {
    channelId: "general",
  });
  assert.equal(afterLeave.result.is_member, false);

  await invokeDobiusBackedTauriCommand("join_channel", { channelId: "general" });
  const afterJoin = await invokeDobiusBackedTauriCommand("get_channel_details", {
    channelId: "general",
  });
  assert.equal(afterJoin.result.is_member, true);

  await invokeDobiusBackedTauriCommand("archive_channel", { channelId: "general" });
  const archived = await invokeDobiusBackedTauriCommand("get_channel_details", {
    channelId: "general",
  });
  assert.ok(archived.result.archived_at, "archive_channel should set archived_at");

  await invokeDobiusBackedTauriCommand("unarchive_channel", { channelId: "general" });
  const unarchived = await invokeDobiusBackedTauriCommand("get_channel_details", {
    channelId: "general",
  });
  assert.equal(unarchived.result.archived_at, null);
  assert.equal(created.result.id, "general");
});

test("add_channel_members returns the AddChannelMembersResult shape and updates membership", async () => {
  installFakeRelay("28".repeat(32));
  const otherPubkey = "2a".repeat(32);

  const created = await invokeDobiusBackedTauriCommand("create_channel", {
    name: "Ops",
    channelType: "stream",
    visibility: "open",
  });
  const channelId = created.result.id;

  const added = await invokeDobiusBackedTauriCommand("add_channel_members", {
    channelId,
    pubkeys: [otherPubkey],
  });
  assert.equal(added.handled, true);
  assert.deepEqual(added.result, { added: [otherPubkey], errors: [] });

  const members = await invokeDobiusBackedTauriCommand("get_channel_members", { channelId });
  assert.equal(members.result.members.length, 2);

  await invokeDobiusBackedTauriCommand("remove_channel_member", { channelId, pubkey: otherPubkey });
  const afterRemove = await invokeDobiusBackedTauriCommand("get_channel_members", { channelId });
  assert.equal(afterRemove.result.members.length, 1);
});

test("delete_channel archives the channel so it stops appearing as active", async () => {
  installFakeRelay("2b".repeat(32));

  const created = await invokeDobiusBackedTauriCommand("create_channel", {
    name: "Temp",
    channelType: "stream",
    visibility: "open",
  });
  const channelId = created.result.id;

  const response = await invokeDobiusBackedTauriCommand("delete_channel", { channelId });
  assert.equal(response.handled, true);
  assert.equal(response.result, undefined);

  const details = await invokeDobiusBackedTauriCommand("get_channel_details", { channelId });
  assert.ok(details.result.archived_at, "delete_channel should leave the channel archived");
});

test("get_channel_window returns channel-scoped messages sorted oldest-first, honoring the cursor", async () => {
  const { identity, events } = installFakeRelay("2d".repeat(32));

  const created = await invokeDobiusBackedTauriCommand("create_channel", {
    name: "Window",
    channelType: "stream",
    visibility: "open",
  });
  const channelId = created.result.id;

  events.push(
    { id: "m1", pubkey: identity.pubkey, created_at: 100, kind: 9, tags: [["h", channelId]], content: "first" },
    { id: "m2", pubkey: identity.pubkey, created_at: 200, kind: 9, tags: [["h", channelId]], content: "second" },
  );

  const window = await invokeDobiusBackedTauriCommand("get_channel_window", {
    channelId,
    limitRows: 10,
    cursor: null,
  });
  assert.equal(window.handled, true);
  assert.deepEqual(window.result.map((event) => event.id), ["m1", "m2"]);

  const paged = await invokeDobiusBackedTauriCommand("get_channel_window", {
    channelId,
    limitRows: 10,
    cursor: { created_at: 100, event_id: "m1" },
  });
  assert.deepEqual(paged.result.map((event) => event.id), []);
});
