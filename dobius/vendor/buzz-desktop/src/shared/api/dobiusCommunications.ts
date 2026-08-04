import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";

type DobiusBridgeResponse =
  | { version: 1; id: string; ok: true; result: unknown }
  | {
      version: 1;
      id: string;
      ok: false;
      error: { code: string; message: string };
    };

type DobiusCommunicationsBridge = {
  invoke(command: string, args?: unknown): Promise<DobiusBridgeResponse>;
};

declare global {
  interface Window {
    dobiusCommunications?: DobiusCommunicationsBridge;
  }
}

export type DobiusWorkstationSnapshot = {
  accounts: unknown;
  agents: unknown;
  repos: unknown;
  status: unknown;
  terminals: unknown;
  worktrees: unknown;
  errors: Record<string, string>;
};

type DobiusAgentRecord = {
  id: string;
  name: string;
  systemPrompt?: string;
  engine?: "claude" | "codex";
  accountId?: string | null;
  model?: string;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
};

type DobiusAgentRunRecord = {
  agentId: string;
  status: string;
};

export type DobiusManagedAgentProjection = {
  pubkey: string;
  name: string;
  persona_id: null;
  runtime: string;
  team_id: null;
  relay_url: string;
  acp_command: string;
  agent_command: string;
  agent_command_override: null;
  agent_args: string[];
  mcp_command: string;
  turn_timeout_seconds: number;
  idle_timeout_seconds: null;
  max_turn_duration_seconds: null;
  parallelism: number;
  system_prompt: string | null;
  avatar_url: null;
  model: string | null;
  model_source: "instance_legacy" | null;
  provider: string | null;
  persona_out_of_date: false;
  persona_orphaned: false;
  needs_restart: false;
  env_vars: Record<string, string>;
  status: "running" | "stopped";
  pid: null;
  created_at: string;
  updated_at: string;
  last_started_at: string | null;
  last_stopped_at: string | null;
  last_exit_code: null;
  last_error: null;
  last_error_code: null;
  log_path: string;
  start_on_app_launch: false;
  auto_restart_on_config_change: false;
  backend: { type: "local" };
  backend_agent_id: string;
  respond_to: "owner-only";
  respond_to_allowlist: string[];
};

export type DobiusPersonaProjection = {
  id: string;
  display_name: string;
  avatar_url: null;
  system_prompt: string;
  runtime: string;
  model: string | null;
  provider: string | null;
  name_pool: string[];
  is_builtin: false;
  is_active: true;
  shared: false;
  source_team: null;
  catalog_source: null;
  env_vars: Record<string, string>;
  respond_to: "owner-only";
  respond_to_allowlist: string[];
  parallelism: number;
  created_at: string;
  updated_at: string;
};

const DOBIUS_RUNTIME_PREFIX = "dobius-native";

function runtimeId(engine: "claude" | "codex", accountId: string | null): string {
  return `${DOBIUS_RUNTIME_PREFIX}:${engine}:${encodeURIComponent(accountId ?? "active")}`;
}

function parseRuntimeSelection(value: unknown): {
  engine: "claude" | "codex";
  accountId: string | null;
} {
  if (typeof value !== "string" || !value.startsWith(`${DOBIUS_RUNTIME_PREFIX}:`)) {
    return { engine: "claude", accountId: null };
  }
  const [, engineValue, encodedAccountId] = value.split(":", 3);
  return {
    engine: engineValue === "codex" ? "codex" : "claude",
    accountId:
      encodedAccountId && encodedAccountId !== "active"
        ? decodeURIComponent(encodedAccountId)
        : null,
  };
}

function runtimeCatalogEntry(args: {
  engine: "claude" | "codex";
  accountId: string | null;
  email?: string;
}) {
  const engineLabel = args.engine === "codex" ? "Codex" : "Claude SDK";
  return {
  id: runtimeId(args.engine, args.accountId),
  label: args.email ? `${engineLabel} · ${args.email}` : `${engineLabel} · active account`,
  avatar_url: "",
  availability: "available",
  command: "dobius",
  binary_path: "dobius",
  default_args: [],
  mcp_command: null,
  model_env_var: null,
  provider_env_var: null,
  thinking_env_var: null,
  install_hint: "Built into Dobius",
  install_instructions_url: "",
  can_auto_install: false,
  requires_external_cli: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "logged_in" },
  login_hint: null,
  source: "builtin",
  } as const;
}

async function discoverDobiusAgentRuntimes(): Promise<unknown[]> {
  const snapshot = await invokeDobiusRuntime("accounts.list");
  const record = snapshot && typeof snapshot === "object"
    ? snapshot as Record<string, unknown>
    : {};
  const entries: unknown[] = [];
  for (const engine of ["claude", "codex"] as const) {
    const state = record[engine];
    const accounts = recordsAt(state, "accounts");
    if (accounts.length === 0) {
      entries.push(runtimeCatalogEntry({ engine, accountId: null }));
      continue;
    }
    for (const candidate of accounts) {
      if (!candidate || typeof candidate !== "object") continue;
      const account = candidate as Record<string, unknown>;
      if (typeof account.id !== "string") continue;
      entries.push(runtimeCatalogEntry({
        engine,
        accountId: account.id,
        email: typeof account.email === "string" ? account.email : undefined,
      }));
    }
  }
  return entries;
}

const DOBIUS_RELAY_WEBSOCKET_URL = "ws://localhost:3300";
const DOBIUS_RELAY_HTTP_URL = "http://localhost:3300";
const DOBIUS_IDENTITY_STORAGE_KEY = "dobius-buzz-identity.v1";
const DOBIUS_AGENT_IDENTITIES_STORAGE_KEY = "dobius-buzz-agent-identities.v1";

type DobiusLocalIdentity = {
  privateKey: string;
  pubkey: string;
  username: string;
};

function localIdentity(): DobiusLocalIdentity {
  const raw = window.localStorage.getItem(DOBIUS_IDENTITY_STORAGE_KEY);
  if (!raw) throw new Error("Dobius Communications identity is unavailable");
  const identity = JSON.parse(raw) as Partial<DobiusLocalIdentity>;
  if (
    typeof identity.privateKey !== "string" ||
    typeof identity.pubkey !== "string" ||
    typeof identity.username !== "string"
  ) {
    throw new Error("Dobius Communications identity is invalid");
  }
  return identity as DobiusLocalIdentity;
}

function signedEventWithPrivateKey(
  args: unknown,
  privateKey: string,
  kindOverride?: number,
): string {
  if (!args || typeof args !== "object") throw new Error("Missing event payload");
  const input = args as Record<string, unknown>;
  const kind = kindOverride ?? input.kind;
  if (typeof kind !== "number") throw new Error("Missing event kind");
  const tags = Array.isArray(input.tags) ? (input.tags as string[][]) : [];
  const content = typeof input.content === "string" ? input.content : "";
  const createdAt =
    typeof input.createdAt === "number"
      ? input.createdAt
      : Math.floor(Date.now() / 1000);
  const event = finalizeEvent(
    { kind, tags, content, created_at: createdAt },
    hexToBytes(privateKey),
  );
  return JSON.stringify(event);
}

function signedEvent(args: unknown, kindOverride?: number): string {
  return signedEventWithPrivateKey(args, localIdentity().privateKey, kindOverride);
}

type RelayEventRecord = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
};

async function queryRelay(filters: Array<Record<string, unknown>>): Promise<RelayEventRecord[]> {
  const response = await fetch(`${DOBIUS_RELAY_HTTP_URL}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pubkey": localIdentity().pubkey,
    },
    body: JSON.stringify(filters),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<RelayEventRecord[]>;
}

type RelaySubmissionResponse = {
  accepted?: boolean;
  event_id?: string;
  message?: string;
};

async function submitRelayEvent(
  serializedEvent: string,
  actorPubkey = localIdentity().pubkey,
): Promise<RelaySubmissionResponse> {
  const response = await fetch(`${DOBIUS_RELAY_HTTP_URL}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pubkey": actorPubkey,
    },
    body: serializedEvent,
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(responseText);
  if (!responseText) return {};
  return JSON.parse(responseText) as RelaySubmissionResponse;
}

type DobiusRelayProfile = {
  pubkey: string;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  nip05_handle: string | null;
  owner_pubkey: null;
  has_profile_event: boolean;
};

function profileFromEvent(
  event: RelayEventRecord | undefined,
  pubkey = localIdentity().pubkey,
): DobiusRelayProfile {
  const identity = localIdentity();
  if (!event) {
    return {
      pubkey,
      display_name: pubkey === identity.pubkey ? identity.username : null,
      avatar_url: null,
      about: null,
      nip05_handle: null,
      owner_pubkey: null,
      has_profile_event: false,
    };
  }
  let content: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(event.content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      content = parsed as Record<string, unknown>;
    }
  } catch {
    // A malformed historical profile must not strand the settings surface.
  }
  const nullableText = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value : null;
  return {
    pubkey,
    display_name: nullableText(content.display_name) ?? nullableText(content.name),
    avatar_url: nullableText(content.picture),
    about: nullableText(content.about),
    nip05_handle: nullableText(content.nip05),
    owner_pubkey: null,
    has_profile_event: true,
  };
}

async function loadDobiusProfile(): Promise<DobiusRelayProfile> {
  const identity = localIdentity();
  const events = await queryRelay([{ kinds: [0], authors: [identity.pubkey], limit: 1 }]);
  return profileFromEvent(events.sort((a, b) => b.created_at - a.created_at)[0]);
}

async function loadDobiusUserProfile(pubkey: string): Promise<DobiusRelayProfile> {
  const events = await queryRelay([{ kinds: [0], authors: [pubkey], limit: 1 }]);
  return profileFromEvent(events.sort((a, b) => b.created_at - a.created_at)[0], pubkey);
}

function userProfileSummary(profile: DobiusRelayProfile): Record<string, unknown> {
  return {
    display_name: profile.display_name,
    name: profile.display_name,
    avatar_url: profile.avatar_url,
    nip05_handle: profile.nip05_handle,
    owner_pubkey: profile.owner_pubkey,
    is_agent: false,
  };
}

async function loadDobiusUsersBatch(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const pubkeys = Array.isArray(input.pubkeys)
    ? input.pubkeys.filter((value): value is string => typeof value === "string")
    : [];
  const events = pubkeys.length
    ? await queryRelay([{ kinds: [0], authors: pubkeys, limit: pubkeys.length }])
    : [];
  const latestByAuthor = new Map<string, RelayEventRecord>();
  for (const event of events.sort((a, b) => b.created_at - a.created_at)) {
    if (!latestByAuthor.has(event.pubkey)) latestByAuthor.set(event.pubkey, event);
  }
  const profiles: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const pubkey of pubkeys) {
    const event = latestByAuthor.get(pubkey);
    if (!event) {
      missing.push(pubkey);
      continue;
    }
    profiles[pubkey] = userProfileSummary(profileFromEvent(event, pubkey));
  }
  return { profiles, missing };
}

async function searchDobiusUsers(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const limit = typeof input.limit === "number" ? Math.max(1, Math.min(input.limit, 100)) : 8;
  const page = Math.max(Number(input.cursor ?? 1) || 1, 1);
  const filter: Record<string, unknown> = { kinds: [0], limit, page };
  if (query) filter.search = query;
  const events = await queryRelay([filter]);
  return {
    users: events.map((event) => ({
      pubkey: event.pubkey,
      ...userProfileSummary(profileFromEvent(event, event.pubkey)),
    })),
    next_cursor: events.length >= limit ? String(page + 1) : null,
  };
}

function normalizedParticipantPubkeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((pubkey): pubkey is string => typeof pubkey === "string")
    .map((pubkey) => pubkey.trim().toLowerCase())
    .filter((pubkey) => /^[a-f0-9]{64}$/.test(pubkey)))];
}

async function openDobiusDm(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const pubkeys = normalizedParticipantPubkeys(input.pubkeys).filter(
    (pubkey) => pubkey !== localIdentity().pubkey.toLowerCase(),
  );
  if (pubkeys.length === 0) throw new Error("Select at least one person to start a DM.");
  if (pubkeys.length > 8) throw new Error("A DM can include at most eight other participants.");

  const submission = await submitRelayEvent(signedEvent({
    kind: 41010,
    content: "",
    tags: pubkeys.map((pubkey) => ["p", pubkey]),
  }));
  const responsePayload = submission.message?.startsWith("response:")
    ? JSON.parse(submission.message.slice("response:".length)) as Record<string, unknown>
    : {};
  const channelId = requiredText(responsePayload.channel_id, "DM channel id");
  const agentResponse = await invokeDobiusRuntime("agent.list");
  const agents = recordsAt(agentResponse, "agents").filter(isDobiusAgentRecord);
  await Promise.all(
    agents
      .filter((agent) => pubkeys.includes(agentIdentity(agent.id).pubkey))
      .map(async (agent) => {
        const identity = agentIdentity(agent.id);
        await submitRelayEvent(
          signedEventWithPrivateKey(
            {
              kind: 0,
              content: JSON.stringify({ display_name: agent.name, name: agent.name }),
              tags: [],
            },
            identity.privateKey,
          ),
          identity.pubkey,
        );
      }),
  );
  const metadata = await queryRelay([{ kinds: [39000], "#d": [channelId], limit: 1 }]);
  const event = metadata.sort((a, b) => b.created_at - a.created_at)[0];
  const participants = event
    ? event.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1])
    : [localIdentity().pubkey, ...pubkeys];
  return {
    id: channelId,
    name: event ? eventTag(event, "name") ?? "DM" : "DM",
    description: event ? eventTag(event, "about") ?? "" : "",
    channel_type: "dm",
    visibility: "private",
    topic: event ? eventTag(event, "topic") : null,
    purpose: event ? eventTag(event, "purpose") : null,
    member_count: participants.length,
    member_pubkeys: participants,
    last_message_at: null,
    archived_at: null,
    participants,
    participant_pubkeys: participants,
    is_member: true,
    ttl_seconds: null,
    ttl_deadline: null,
  };
}

function normalizedStringTags(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is unknown[] => Array.isArray(tag))
    .map((tag) => tag.filter((part): part is string => typeof part === "string"))
    .filter((tag) => tag.length > 0);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function publishDobiusAgentReply(args: {
  agent: DobiusAgentRecord;
  channelId: string;
  parentEventId: string;
  content: string;
}): Promise<void> {
  const identity = agentIdentity(args.agent.id);
  await submitRelayEvent(
    signedEventWithPrivateKey(
      {
        kind: 9,
        content: args.content,
        tags: [
          ["h", args.channelId],
          ["p", localIdentity().pubkey],
          ["e", args.parentEventId, "", "reply"],
        ],
      },
      identity.privateKey,
    ),
    identity.pubkey,
  );
}

async function awaitDobiusAgentRun(agent: DobiusAgentRecord, runId: string): Promise<string> {
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await invokeDobiusRuntime("agent.runs", { agentId: agent.id });
    const run = recordsAt(response, "runs").find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        (candidate as Record<string, unknown>).id === runId,
    ) as Record<string, unknown> | undefined;
    if (run && run.status !== "running") {
      const summary = typeof run.summary === "string" ? run.summary.trim() : "";
      if (run.status === "success") return summary || `${agent.name} completed the task.`;
      return `${agent.name} could not complete the task${summary ? `: ${summary}` : "."}`;
    }
    await delay(750);
  }
  return `${agent.name} is still working. Its run remains available in Dobius Agents.`;
}

async function dispatchMessageToDobiusAgents(args: {
  channelId: string;
  eventId: string;
  content: string;
  participantPubkeys: string[];
}): Promise<void> {
  const response = await invokeDobiusRuntime("agent.list");
  const agents = recordsAt(response, "agents").filter(isDobiusAgentRecord);
  // Why: ordinary DM messages do not repeat the recipient as an @mention. Resolve
  // room membership so opening an agent DM and typing naturally still wakes it.
  const roomEvents = await queryRelay([
    { kinds: [39000, 39002], "#d": [args.channelId], limit: 1000 },
  ]).catch(() => []);
  const roomPubkeys = roomEvents.flatMap((event) =>
    event.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]),
  );
  const targetPubkeys = new Set(
    [...args.participantPubkeys, ...roomPubkeys].map((value) => value.toLowerCase()),
  );
  const targets: DobiusAgentRecord[] = [];
  for (const agent of agents) {
    if (targetPubkeys.has(agentIdentity(agent.id).pubkey)) targets.push(agent);
  }
  await Promise.all(
    targets.map(async (agent) => {
      try {
        const started = await invokeDobiusRuntime("agent.run", {
          id: agent.id,
          prompt: args.content,
        });
        const runId = requiredText(
          started && typeof started === "object"
            ? (started as Record<string, unknown>).runId
            : undefined,
          "agent run id",
        );
        const reply = await awaitDobiusAgentRun(agent, runId);
        await publishDobiusAgentReply({
          agent,
          channelId: args.channelId,
          parentEventId: args.eventId,
          content: reply,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await publishDobiusAgentReply({
          agent,
          channelId: args.channelId,
          parentEventId: args.eventId,
          content: `${agent.name} could not start: ${message}`,
        }).catch(() => undefined);
      }
    }),
  );
}

async function sendDobiusChannelMessage(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const content = typeof input.content === "string" ? input.content.trim() : "";
  const parentEventId =
    typeof input.parentEventId === "string" && input.parentEventId.trim()
      ? input.parentEventId.trim()
      : null;
  const kind = typeof input.kind === "number" ? input.kind : 9;
  const selfPubkey = localIdentity().pubkey.toLowerCase();
  const mentionPubkeys = normalizedParticipantPubkeys(input.mentionPubkeys).filter(
    (pubkey) => pubkey !== selfPubkey,
  );
  const tags: string[][] = [["h", channelId]];

  for (const pubkey of mentionPubkeys) tags.push(["p", pubkey]);
  if (parentEventId) {
    const [parent] = await queryRelay([{ ids: [parentEventId], limit: 1 }]);
    const rootEventId =
      parent?.tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1] ??
      parentEventId;
    if (parent?.pubkey && parent.pubkey.toLowerCase() !== selfPubkey) {
      tags.push(["p", parent.pubkey]);
    }
    if (rootEventId !== parentEventId) tags.push(["e", rootEventId, "", "root"]);
    tags.push(["e", parentEventId, "", "reply"]);
  }

  tags.push(
    ...normalizedStringTags(input.mediaTags),
    ...normalizedStringTags(input.emojiTags),
    ...normalizedStringTags(input.mentionTags),
  );
  if (!content && tags.length === 1) {
    throw new Error("A message needs text or an attachment.");
  }

  const createdAt = Math.floor(Date.now() / 1000);
  const submission = await submitRelayEvent(signedEvent({ kind, content, tags, createdAt }));
  if (submission.accepted === false) {
    throw new Error(submission.message || "The relay rejected the message.");
  }
  const eventId = requiredText(submission.event_id, "message event id");
  // Why: Buzz owns room delivery while Dobius owns execution; dispatch only
  // participants backed by the real Dobius agent store after relay acceptance.
  void dispatchMessageToDobiusAgents({
    channelId,
    eventId,
    content,
    participantPubkeys: mentionPubkeys,
  });
  const rootEventId = parentEventId
    ? tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1] ?? parentEventId
    : null;
  return {
    event_id: eventId,
    parent_event_id: parentEventId,
    root_event_id: rootEventId,
    depth: parentEventId ? (rootEventId === parentEventId ? 1 : 2) : 0,
    created_at: createdAt,
  };
}

async function updateDobiusProfile(args: unknown): Promise<DobiusRelayProfile> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const current = await loadDobiusProfile();
  const choose = (key: string, previous: string | null): string | null =>
    typeof input[key] === "string" ? (input[key] as string).trim() || null : previous;
  const displayName = choose("displayName", current.display_name);
  const content = JSON.stringify({
    display_name: displayName ?? undefined,
    name: displayName ?? undefined,
    picture: choose("avatarUrl", current.avatar_url) ?? undefined,
    about: choose("about", current.about) ?? undefined,
    nip05: choose("nip05Handle", current.nip05_handle) ?? undefined,
  });
  await submitRelayEvent(signedEvent({ kind: 0, content, tags: [] }));
  return profileFromEvent({
    id: "pending-profile",
    pubkey: localIdentity().pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 0,
    tags: [],
    content,
  });
}

function eventTag(event: RelayEventRecord, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null;
}

async function loadRelayChannels(): Promise<unknown[]> {
  const identity = localIdentity();
  const [memberships, metadata, visibility] = await Promise.all([
    queryRelay([{ kinds: [39002], "#p": [identity.pubkey], limit: 1000 }]),
    queryRelay([{ kinds: [39000], limit: 200 }]),
    queryRelay([{ kinds: [30622], "#p": [identity.pubkey], limit: 1 }]),
  ]);
  const memberIds = new Set(
    memberships.flatMap((event) =>
      event.tags.filter((tag) => tag[0] === "d").map((tag) => tag[1]),
    ),
  );
  const latestVisibility = visibility.sort((a, b) => b.created_at - a.created_at)[0];
  const hiddenDms = new Set(
    (latestVisibility?.tags ?? [])
      .filter((tag) => tag[0] === "h")
      .map((tag) => tag[1]),
  );
  return metadata
    .map((event) => {
      const id = eventTag(event, "d") ?? "";
      const channelType = eventTag(event, "t") ?? "stream";
      const membership = memberships.find((candidate) => eventTag(candidate, "d") === id);
      const participants = (membership?.tags ?? [])
        .filter((tag) => tag[0] === "p")
        .map((tag) => tag[1]);
      return {
        id,
        name: eventTag(event, "name") ?? "",
        description: eventTag(event, "about") ?? "",
        channel_type: channelType,
        visibility: event.tags.some((tag) => tag[0] === "private") ? "private" : "open",
        topic: eventTag(event, "topic"),
        purpose: eventTag(event, "purpose"),
        member_count: participants.length,
        last_message_at: null,
        archived_at: event.tags.some((tag) => tag[0] === "archived" && tag[1] === "true")
          ? new Date(event.created_at * 1000).toISOString()
          : null,
        participants,
        participant_pubkeys: participants,
        ttl_seconds: eventTag(event, "ttl") ? Number(eventTag(event, "ttl")) : null,
        ttl_deadline: eventTag(event, "ttl_deadline"),
        is_member: memberIds.has(id),
      };
    })
    .filter((channel) => channel.channel_type !== "dm" || !hiddenDms.has(channel.id));
}

async function loadDobiusChannelMembers(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const [membershipEvents, agentResponse] = await Promise.all([
    queryRelay([{ kinds: [39002], "#d": [channelId], limit: 20 }]),
    invokeDobiusRuntime("agent.list"),
  ]);
  const latest = membershipEvents.sort((a, b) => b.created_at - a.created_at)[0];
  const agents = recordsAt(agentResponse, "agents").filter(isDobiusAgentRecord);
  const agentByPubkey = new Map(
    agents.map((agent) => [agentIdentity(agent.id).pubkey.toLowerCase(), agent]),
  );
  const members = (latest?.tags ?? [])
    .filter((tag) => tag[0] === "p" && typeof tag[1] === "string")
    .map((tag) => {
      const pubkey = tag[1].toLowerCase();
      const agent = agentByPubkey.get(pubkey);
      const role = tag[3] ?? tag[2] ?? (agent ? "bot" : "member");
      return {
        pubkey,
        role,
        is_agent: Boolean(agent) || role === "bot",
        joined_at: new Date((latest?.created_at ?? 0) * 1000).toISOString(),
        display_name: agent?.name ?? (pubkey === localIdentity().pubkey ? localIdentity().username : null),
      };
    });
  return { members, next_cursor: null };
}

const DOBIUS_CHANNEL_METADATA_KIND = 39000;
const DOBIUS_CHANNEL_MEMBERSHIP_KIND = 39002;
const DOBIUS_CHANNEL_MESSAGE_KINDS = [1, 9, 40002, 45001, 45003];

function slugifyChannelName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "channel"}-${crypto.randomUUID().slice(0, 8)}`;
}

async function latestChannelEvent(kind: number, channelId: string): Promise<RelayEventRecord | null> {
  const events = await queryRelay([{ kinds: [kind], "#d": [channelId], limit: 20 }]);
  return events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

function channelMetadataTags(args: {
  channelId: string;
  name: string;
  description?: string | null;
  channelType?: string;
  topic?: string | null;
  purpose?: string | null;
  visibility?: string;
  archived?: boolean;
  ttlSeconds?: number | null;
}): string[][] {
  const tags: string[][] = [
    ["d", args.channelId],
    ["name", args.name],
    ["t", args.channelType ?? "stream"],
  ];
  if (args.description) tags.push(["about", args.description]);
  if (args.topic) tags.push(["topic", args.topic]);
  if (args.purpose) tags.push(["purpose", args.purpose]);
  if (args.visibility === "private") tags.push(["private", "true"]);
  if (args.archived) tags.push(["archived", "true"]);
  if (typeof args.ttlSeconds === "number" && args.ttlSeconds > 0) {
    tags.push(["ttl", String(args.ttlSeconds)]);
    tags.push(["ttl_deadline", String(Math.floor(Date.now() / 1000) + args.ttlSeconds)]);
  }
  return tags;
}

async function publishChannelMetadata(tags: string[][]): Promise<void> {
  const submission = await submitRelayEvent(
    signedEvent({ kind: DOBIUS_CHANNEL_METADATA_KIND, content: "", tags }),
  );
  if (submission.accepted === false) {
    throw new Error(submission.message || "The relay rejected the channel update.");
  }
}

async function channelMembership(
  channelId: string,
): Promise<{ tags: string[][]; members: Map<string, string> }> {
  const latest = await latestChannelEvent(DOBIUS_CHANNEL_MEMBERSHIP_KIND, channelId);
  const members = new Map<string, string>();
  for (const tag of latest?.tags ?? []) {
    if (tag[0] === "p" && typeof tag[1] === "string") {
      members.set(tag[1].toLowerCase(), tag[2] ?? "member");
    }
  }
  return { tags: latest?.tags ?? [["d", channelId]], members };
}

async function publishChannelMembership(channelId: string, members: Map<string, string>): Promise<void> {
  const tags: string[][] = [["d", channelId]];
  for (const [pubkey, role] of members) tags.push(["p", pubkey, role]);
  const submission = await submitRelayEvent(
    signedEvent({ kind: DOBIUS_CHANNEL_MEMBERSHIP_KIND, content: "", tags }),
  );
  if (submission.accepted === false) {
    throw new Error(submission.message || "The relay rejected the membership update.");
  }
}

// Note: `member_pubkeys` and the `RawChannelDetail`-only fields below exist
// because the upstream renderer's `fromRawChannel`/`fromRawChannelDetail`
// mappers read them directly (see tauriChannels.ts); leaving one out reads
// as `undefined` in the UI instead of a real value.
function channelDetailFromEvent(metadata: RelayEventRecord, memberPubkeys: string[]): unknown {
  const channelId = eventTag(metadata, "d") ?? "";
  const createdAtIso = new Date(metadata.created_at * 1000).toISOString();
  const topic = eventTag(metadata, "topic");
  const purpose = eventTag(metadata, "purpose");
  return {
    id: channelId,
    name: eventTag(metadata, "name") ?? "",
    description: eventTag(metadata, "about") ?? "",
    channel_type: eventTag(metadata, "t") ?? "stream",
    visibility: metadata.tags.some((tag) => tag[0] === "private") ? "private" : "open",
    topic,
    purpose,
    member_count: memberPubkeys.length,
    member_pubkeys: memberPubkeys,
    last_message_at: null,
    archived_at: metadata.tags.some((tag) => tag[0] === "archived" && tag[1] === "true")
      ? createdAtIso
      : null,
    participants: memberPubkeys,
    participant_pubkeys: memberPubkeys,
    is_member: memberPubkeys.includes(localIdentity().pubkey.toLowerCase()),
    ttl_seconds: eventTag(metadata, "ttl") ? Number(eventTag(metadata, "ttl")) : null,
    ttl_deadline: eventTag(metadata, "ttl_deadline"),
    created_by: metadata.pubkey,
    created_at: createdAtIso,
    updated_at: createdAtIso,
    topic_set_by: topic ? metadata.pubkey : null,
    topic_set_at: topic ? createdAtIso : null,
    purpose_set_by: purpose ? metadata.pubkey : null,
    purpose_set_at: purpose ? createdAtIso : null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
  };
}

async function getDobiusChannelDetails(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const [metadata, { members }] = await Promise.all([
    latestChannelEvent(DOBIUS_CHANNEL_METADATA_KIND, channelId),
    channelMembership(channelId),
  ]);
  if (!metadata) throw new Error(`Channel not found: ${channelId}`);
  return channelDetailFromEvent(metadata, [...members.keys()]);
}

async function createDobiusChannel(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const name = requiredText(input.name, "channel name");
  const channelId =
    typeof input.channelId === "string" && input.channelId.trim()
      ? input.channelId.trim()
      : slugifyChannelName(name);
  const description = typeof input.description === "string" ? input.description : null;
  const channelType = typeof input.channelType === "string" ? input.channelType : "stream";
  const visibility = typeof input.visibility === "string" ? input.visibility : "open";
  const ttlSeconds = typeof input.ttlSeconds === "number" ? input.ttlSeconds : null;

  await publishChannelMetadata(
    channelMetadataTags({ channelId, name, description, channelType, visibility, ttlSeconds }),
  );

  const selfPubkey = localIdentity().pubkey.toLowerCase();
  const members = new Map<string, string>([[selfPubkey, "owner"]]);
  for (const pubkey of normalizedParticipantPubkeys(input.memberPubkeys)) {
    if (pubkey !== selfPubkey) members.set(pubkey, "member");
  }
  await publishChannelMembership(channelId, members);

  return getDobiusChannelDetails({ channelId });
}

/** `update_channel` args arrive wrapped as `{ input: UpdateChannelInput }`; unwrap before use. */
function unwrapChannelUpdateInput(args: unknown): Record<string, unknown> {
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const wrapped = record.input;
  return wrapped && typeof wrapped === "object" ? (wrapped as Record<string, unknown>) : record;
}

async function updateDobiusChannel(args: unknown): Promise<unknown> {
  const input = unwrapChannelUpdateInput(args);
  const channelId = requiredText(input.channelId, "channel id");
  const existing = await latestChannelEvent(DOBIUS_CHANNEL_METADATA_KIND, channelId);
  if (!existing) throw new Error(`Channel not found: ${channelId}`);

  const name = typeof input.name === "string" ? input.name : eventTag(existing, "name") ?? channelId;
  const description =
    typeof input.description === "string" ? input.description : eventTag(existing, "about");
  const channelType = eventTag(existing, "t") ?? "stream";
  const topic = typeof input.topic === "string" ? input.topic : eventTag(existing, "topic");
  const purpose = typeof input.purpose === "string" ? input.purpose : eventTag(existing, "purpose");
  const visibility =
    typeof input.visibility === "string"
      ? input.visibility
      : existing.tags.some((tag) => tag[0] === "private")
        ? "private"
        : "open";
  const archived = existing.tags.some((tag) => tag[0] === "archived" && tag[1] === "true");
  const existingTtl = eventTag(existing, "ttl");
  // UpdateChannelInput: omit ttlSeconds to leave unchanged, null clears it, a number sets it.
  const ttlSeconds =
    "ttlSeconds" in input
      ? (input.ttlSeconds as number | null)
      : existingTtl
        ? Number(existingTtl)
        : null;

  await publishChannelMetadata(
    channelMetadataTags({
      channelId,
      name,
      description,
      channelType,
      topic,
      purpose,
      visibility,
      archived,
      ttlSeconds
    }),
  );
  return getDobiusChannelDetails({ channelId });
}

async function deleteDobiusChannel(args: unknown): Promise<void> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const metadata = await latestChannelEvent(DOBIUS_CHANNEL_METADATA_KIND, channelId);
  if (!metadata) throw new Error(`Channel not found: ${channelId}`);

  // Nostr has no hard delete for addressable events; archive so the channel
  // stops surfacing as active, and publish a NIP-09 delete request against
  // the addressable coordinate for relays that honor it.
  await setDobiusChannelArchived({ channelId }, true);
  await publishDobiusMutation(5, "", [["a", `${DOBIUS_CHANNEL_METADATA_KIND}:${metadata.pubkey}:${channelId}`]]);
}

async function setDobiusChannelArchived(args: unknown, archived: boolean): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const existing = await latestChannelEvent(DOBIUS_CHANNEL_METADATA_KIND, channelId);
  if (!existing) throw new Error(`Channel not found: ${channelId}`);

  await publishChannelMetadata(
    channelMetadataTags({
      channelId,
      name: eventTag(existing, "name") ?? channelId,
      description: eventTag(existing, "about"),
      channelType: eventTag(existing, "t") ?? "stream",
      topic: eventTag(existing, "topic"),
      purpose: eventTag(existing, "purpose"),
      visibility: existing.tags.some((tag) => tag[0] === "private") ? "private" : "open",
      archived,
    }),
  );
  return getDobiusChannelDetails({ channelId });
}

async function joinDobiusChannel(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const { members } = await channelMembership(channelId);
  members.set(localIdentity().pubkey.toLowerCase(), "member");
  await publishChannelMembership(channelId, members);
  return getDobiusChannelDetails({ channelId });
}

async function leaveDobiusChannel(args: unknown): Promise<void> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const { members } = await channelMembership(channelId);
  members.delete(localIdentity().pubkey.toLowerCase());
  await publishChannelMembership(channelId, members);
}

async function addDobiusChannelMembers(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const role = typeof input.role === "string" ? input.role : "member";
  const requested = normalizedParticipantPubkeys(input.pubkeys);

  const { members } = await channelMembership(channelId);
  for (const pubkey of requested) members.set(pubkey, role);
  await publishChannelMembership(channelId, members);

  return { added: requested, errors: [] };
}

async function removeDobiusChannelMember(args: unknown): Promise<void> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const pubkey = requiredText(input.pubkey, "member pubkey");
  const { members } = await channelMembership(channelId);
  members.delete(pubkey.toLowerCase());
  await publishChannelMembership(channelId, members);
}

async function changeDobiusChannelMemberRole(args: unknown): Promise<void> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const pubkey = requiredText(input.pubkey, "member pubkey");
  const role = requiredText(input.role, "member role");
  const { members } = await channelMembership(channelId);
  if (!members.has(pubkey.toLowerCase())) {
    throw new Error(`${pubkey} is not a member of channel ${channelId}`);
  }
  members.set(pubkey.toLowerCase(), role);
  await publishChannelMembership(channelId, members);
}

async function ensureDobiusStarterChannels(): Promise<unknown[]> {
  const existing = (await loadRelayChannels()) as Array<Record<string, unknown>>;
  const existingIds = new Set(existing.map((channel) => channel.id));
  const starters = [{ id: "general", name: "general", description: "Default Dobius Communications channel" }];
  for (const starter of starters) {
    if (existingIds.has(starter.id)) continue;
    await createDobiusChannel({
      channelId: starter.id,
      name: starter.name,
      description: starter.description,
    });
  }
  return loadRelayChannels();
}

async function getDobiusChannelWindow(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const limitRows =
    typeof input.limitRows === "number" ? Math.max(1, Math.min(input.limitRows, 200)) : 50;
  const cursor =
    input.cursor && typeof input.cursor === "object" ? (input.cursor as Record<string, unknown>) : null;

  const filter: Record<string, unknown> = {
    kinds: DOBIUS_CHANNEL_MESSAGE_KINDS,
    "#h": [channelId],
    limit: limitRows,
  };
  if (cursor && typeof cursor.created_at === "number") filter.until = cursor.created_at;

  const events = await queryRelay([filter]);
  const cursorEventId = cursor && typeof cursor.event_id === "string" ? cursor.event_id : null;
  const filtered = cursorEventId ? events.filter((event) => event.id !== cursorEventId) : events;
  return filtered.sort((a, b) => a.created_at - b.created_at);
}

async function loadRelayFeed(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const limit = typeof input.limit === "number" ? input.limit : 50;
  const identity = localIdentity();
  const events = await queryRelay([
    { kinds: [1, 9, 40002, 45001, 45003], "#p": [identity.pubkey], limit },
  ]);
  const channelIds = [...new Set(events.map((event) => eventTag(event, "h")).filter(Boolean))];
  const metadata = channelIds.length
    ? await queryRelay([{ kinds: [39000], "#d": channelIds, limit: channelIds.length }])
    : [];
  const channelNames = new Map(
    metadata.map((event) => [eventTag(event, "d"), eventTag(event, "name") ?? ""]),
  );
  const mentions = events.map((event) => {
    const channelId = eventTag(event, "h");
    return {
      ...event,
      channel_id: channelId,
      channel_name: channelId ? channelNames.get(channelId) ?? "" : "",
      channel_type: null,
      category: "mention",
    };
  });
  const now = Math.floor(Date.now() / 1000);
  return {
    feed: { mentions, needs_action: [], activity: [], agent_activity: [] },
    meta: {
      since: typeof input.since === "number" ? input.since : now - 7 * 86400,
      total: mentions.length,
      generated_at: now,
    },
  };
}

async function getDobiusEvent(args: unknown): Promise<string> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const eventId = requiredText(input.eventId, "event id");
  const [event] = await queryRelay([{ ids: [eventId], limit: 1 }]);
  if (!event) throw new Error(`Message not found: ${eventId}`);
  return JSON.stringify(event);
}

async function searchDobiusMessages(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const query = requiredText(input.q, "search query");
  const limit = typeof input.limit === "number" ? Math.max(1, Math.min(input.limit, 100)) : 50;
  const filter: Record<string, unknown> = { kinds: [1, 9, 40002, 45001, 45003], search: query, limit };
  if (typeof input.channelId === "string" && input.channelId) filter["#h"] = [input.channelId];
  if (Array.isArray(input.authors) && input.authors.length) filter.authors = input.authors;
  if (typeof input.since === "number") filter.since = input.since;
  if (typeof input.until === "number") filter.until = input.until;
  const events = await queryRelay([filter]);
  return {
    hits: events.map((event) => ({
      event_id: event.id,
      content: event.content,
      kind: event.kind,
      pubkey: event.pubkey,
      channel_id: eventTag(event, "h"),
      channel_name: null,
      created_at: event.created_at,
      score: 1,
    })),
    found: events.length,
  };
}

async function getDobiusThreadReplies(args: unknown): Promise<unknown> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const rootEventId = requiredText(input.rootEventId, "thread root event id");
  const limit = typeof input.limit === "number" ? Math.max(1, Math.min(input.limit, 500)) : 100;
  const filter: Record<string, unknown> = { kinds: [1, 9, 40002, 45003], "#e": [rootEventId], limit };
  if (typeof input.channelId === "string" && input.channelId) filter["#h"] = [input.channelId];
  const events = (await queryRelay([filter])).sort(
    (left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id),
  );
  return { events, next_cursor: null };
}

async function publishDobiusMutation(kind: number, content: string, tags: string[][]): Promise<void> {
  const submission = await submitRelayEvent(signedEvent({ kind, content, tags }));
  if (submission.accepted === false) throw new Error(submission.message || "The relay rejected the action.");
}

async function editDobiusMessage(args: unknown): Promise<void> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const channelId = requiredText(input.channelId, "channel id");
  const eventId = requiredText(input.eventId, "message event id");
  const content = requiredText(input.content, "message content");
  await publishDobiusMutation(40003, content, [["h", channelId], ["e", eventId]]);
}

async function deleteDobiusMessage(args: unknown): Promise<void> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  await publishDobiusMutation(9005, "", [
    ["h", requiredText(input.channelId, "channel id")],
    ["e", requiredText(input.eventId, "message event id")],
  ]);
}

async function addDobiusReaction(args: unknown): Promise<void> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const tags = [["e", requiredText(input.eventId, "message event id")]];
  if (typeof input.emojiUrl === "string" && input.emojiUrl) {
    tags.push(["emoji", requiredText(input.emoji, "emoji"), input.emojiUrl]);
  }
  await publishDobiusMutation(7, requiredText(input.emoji, "emoji"), tags);
}

async function removeDobiusReaction(args: unknown): Promise<void> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const eventId = requiredText(input.eventId, "message event id");
  const emoji = requiredText(input.emoji, "emoji");
  const [reaction] = await queryRelay([{
    kinds: [7],
    "#e": [eventId],
    authors: [localIdentity().pubkey],
    limit: 100,
  }]).then((events) => events.filter((event) => event.content === emoji));
  if (!reaction) return;
  await publishDobiusMutation(5, "", [["e", reaction.id]]);
}

export function isDobiusCommunicationsAvailable(): boolean {
  return typeof window.dobiusCommunications?.invoke === "function";
}

export async function invokeDobiusRuntime(
  command: string,
  args: unknown = {},
): Promise<unknown> {
  const bridge = window.dobiusCommunications;
  if (!bridge) {
    throw new Error("Dobius Communications bridge is unavailable");
  }

  const response = await bridge.invoke(command, args);
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`);
  }
  return response.result;
}

export async function loadDobiusWorkstationSnapshot(
  timeoutMs = 5_000,
): Promise<DobiusWorkstationSnapshot> {
  const requests = {
    accounts: ["accounts.list", {}],
    agents: ["agent.list", {}],
    repos: ["repo.list", {}],
    status: ["status.get", {}],
    terminals: ["terminal.list", { limit: 100 }],
    worktrees: ["worktree.ps", { limit: 100 }],
  } as const;
  const errors: Record<string, string> = {};
  const entries = await Promise.all(
    Object.entries(requests).map(async ([key, [command, args]]) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([
          invokeDobiusRuntime(command, args),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`${command} timed out after ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ]);
        return [key, value] as const;
      } catch (reason) {
        errors[key] = reason instanceof Error ? reason.message : String(reason);
        return [key, null] as const;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }),
  );
  const values = Object.fromEntries(entries) as Omit<
    DobiusWorkstationSnapshot,
    "errors"
  >;
  return { ...values, errors };
}

export function collectionSize(value: unknown, keys: readonly string[]): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate.length;
  }
  return 0;
}

function recordsAt(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate : [];
}

function isDobiusAgentRecord(value: unknown): value is DobiusAgentRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DobiusAgentRecord>;
  return typeof candidate.id === "string" && typeof candidate.name === "string";
}

function isDobiusAgentRunRecord(value: unknown): value is DobiusAgentRunRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DobiusAgentRunRecord>;
  return (
    typeof candidate.agentId === "string" && typeof candidate.status === "string"
  );
}

type DobiusAgentIdentity = { privateKey: string; pubkey: string };

function loadAgentIdentityRegistry(): Record<string, DobiusAgentIdentity> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DOBIUS_AGENT_IDENTITIES_STORAGE_KEY) ?? "{}",
    ) as Record<string, DobiusAgentIdentity>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function agentIdentity(agentId: string): DobiusAgentIdentity {
  const identities = loadAgentIdentityRegistry();
  const existing = identities[agentId];
  if (
    existing &&
    /^[a-f0-9]{64}$/.test(existing.privateKey) &&
    /^[a-f0-9]{64}$/.test(existing.pubkey)
  ) {
    return existing;
  }
  const privateKey = bytesToHex(generateSecretKey());
  const identity = { privateKey, pubkey: getPublicKey(hexToBytes(privateKey)) };
  identities[agentId] = identity;
  window.localStorage.setItem(DOBIUS_AGENT_IDENTITIES_STORAGE_KEY, JSON.stringify(identities));
  return identity;
}

async function projectionPubkey(agentId: string): Promise<string> {
  // Why: room participants need a real signing identity, not a display-only
  // hash, so native Dobius runs can answer as themselves in Communications.
  return agentIdentity(agentId).pubkey;
}

function timestampIso(value: number | undefined): string {
  return new Date(typeof value === "number" ? value : 0).toISOString();
}

function objectAt(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`Dobius returned an invalid ${key} response`);
  }
  const candidate = (value as Record<string, unknown>)[key];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`Dobius returned no ${key}`);
  }
  return candidate as Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${field}`);
  }
  return value.trim();
}

function personaFromAgent(agent: DobiusAgentRecord): DobiusPersonaProjection {
  return {
    id: agent.id,
    display_name: agent.name,
    avatar_url: null,
    system_prompt: agent.systemPrompt ?? "",
    runtime: runtimeId(agent.engine === "codex" ? "codex" : "claude", agent.accountId ?? null),
    model: agent.model?.trim() || null,
    provider: agent.accountId?.trim() || null,
    name_pool: [],
    is_builtin: false,
    is_active: true,
    shared: false,
    source_team: null,
    catalog_source: null,
    env_vars: {},
    respond_to: "owner-only",
    respond_to_allowlist: [],
    parallelism: 1,
    created_at: timestampIso(agent.createdAt),
    updated_at: timestampIso(agent.updatedAt),
  };
}

export async function loadDobiusManagedAgents(): Promise<DobiusManagedAgentProjection[]> {
  const [agentResponse, runResponse] = await Promise.all([
    invokeDobiusRuntime("agent.list"),
    invokeDobiusRuntime("agent.runs"),
  ]);
  const agents = recordsAt(agentResponse, "agents").filter(isDobiusAgentRecord);
  const runs = recordsAt(runResponse, "runs").filter(isDobiusAgentRunRecord);
  const runningAgentIds = new Set(
    runs.filter((run) => run.status === "running").map((run) => run.agentId),
  );

  return Promise.all(
    agents.map(async (agent) => ({
      pubkey: await projectionPubkey(agent.id),
      name: agent.name,
      persona_id: null,
      runtime: runtimeId(
        agent.engine === "codex" ? "codex" : "claude",
        agent.accountId ?? null,
      ),
      team_id: null,
      relay_url: "dobius://communications",
      acp_command: "",
      agent_command: "dobius",
      agent_command_override: null,
      agent_args: [],
      mcp_command: "",
      turn_timeout_seconds: 0,
      idle_timeout_seconds: null,
      max_turn_duration_seconds: null,
      parallelism: 1,
      system_prompt: agent.systemPrompt ?? null,
      avatar_url: null,
      model: agent.model?.trim() || null,
      model_source: agent.model?.trim() ? ("instance_legacy" as const) : null,
      provider: agent.accountId?.trim() || null,
      persona_out_of_date: false as const,
      persona_orphaned: false as const,
      needs_restart: false as const,
      env_vars: {},
      status: runningAgentIds.has(agent.id)
        ? ("running" as const)
        : ("stopped" as const),
      pid: null,
      created_at: timestampIso(agent.createdAt),
      updated_at: timestampIso(agent.updatedAt),
      last_started_at: null,
      last_stopped_at: null,
      last_exit_code: null,
      last_error: null,
      last_error_code: null,
      log_path: agent.cwd ?? "",
      start_on_app_launch: false as const,
      auto_restart_on_config_change: false as const,
      backend: { type: "local" as const },
      backend_agent_id: agent.id,
      respond_to: "owner-only" as const,
      respond_to_allowlist: [],
    })),
  );
}

async function managedAgentByPubkey(args: unknown): Promise<DobiusManagedAgentProjection> {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const pubkey = requiredText(input.pubkey, "agent pubkey").toLowerCase();
  const agent = (await loadDobiusManagedAgents()).find(
    (candidate) => candidate.pubkey.toLowerCase() === pubkey,
  );
  if (!agent) throw new Error(`Dobius agent not found for ${pubkey}`);
  return agent;
}

async function startDobiusManagedAgent(args: unknown): Promise<DobiusManagedAgentProjection> {
  const agent = await managedAgentByPubkey(args);
  // Why: Dobius agents are OAuth-backed, on-demand workers rather than resident
  // ACP child processes. "Start" means the agent is ready for the next message;
  // send_channel_message owns creating the actual run.
  return {
    ...agent,
    status: "running",
    last_started_at: new Date().toISOString(),
    last_error: null,
    last_error_code: null,
  };
}

async function stopDobiusManagedAgent(args: unknown): Promise<DobiusManagedAgentProjection> {
  const agent = await managedAgentByPubkey(args);
  return {
    ...agent,
    status: "stopped",
    last_stopped_at: new Date().toISOString(),
  };
}

export async function loadDobiusPersonas(): Promise<DobiusPersonaProjection[]> {
  const response = await invokeDobiusRuntime("agent.list");
  return recordsAt(response, "agents")
    .filter(isDobiusAgentRecord)
    .map(personaFromAgent);
}

async function createDobiusPersona(args: unknown): Promise<DobiusPersonaProjection> {
  const input = objectAt(args, "input");
  const runtime = parseRuntimeSelection(input.runtime);
  const response = await invokeDobiusRuntime("agent.create", {
    name: requiredText(input.displayName, "agent name"),
    systemPrompt:
      typeof input.systemPrompt === "string" ? input.systemPrompt : undefined,
    engine: runtime.engine,
    accountId: runtime.accountId,
    model: typeof input.model === "string" ? input.model : undefined,
  });
  const agent = objectAt(response, "agent");
  if (!isDobiusAgentRecord(agent)) {
    throw new Error("Dobius returned an invalid created agent");
  }
  return personaFromAgent(agent);
}

async function updateDobiusPersona(args: unknown): Promise<DobiusPersonaProjection> {
  const input = objectAt(args, "input");
  const id = requiredText(input.id, "agent id");
  const updates: Record<string, unknown> = {};
  if (typeof input.displayName === "string") updates.name = input.displayName.trim();
  if (typeof input.systemPrompt === "string") updates.systemPrompt = input.systemPrompt;
  if (typeof input.runtime === "string") {
    const runtime = parseRuntimeSelection(input.runtime);
    updates.engine = runtime.engine;
    updates.accountId = runtime.accountId;
  }
  if (typeof input.model === "string") updates.model = input.model;
  const response = await invokeDobiusRuntime("agent.update", { id, updates });
  const agent = objectAt(response, "agent");
  if (!isDobiusAgentRecord(agent)) {
    throw new Error("Dobius returned an invalid updated agent");
  }
  return personaFromAgent(agent);
}

async function createDobiusManagedAgent(args: unknown): Promise<unknown> {
  const input = objectAt(args, "input");
  const personaId = requiredText(input.personaId, "persona id");
  const agents = await loadDobiusManagedAgents();
  const agent = agents.find((candidate) => candidate.backend_agent_id === personaId);
  if (!agent) {
    throw new Error(`Dobius agent not found after creation: ${personaId}`);
  }
  return {
    agent,
    private_key_nsec: "",
    profile_sync_error: null,
    spawn_error: null,
  };
}

export async function invokeDobiusBackedTauriCommand(
  command: string,
  args?: unknown,
): Promise<{ handled: false } | { handled: true; result: unknown }> {
  if (!isDobiusCommunicationsAvailable()) return { handled: false };

  switch (command) {
    case "is_shared_identity":
      return { handled: true, result: false };
    case "get_identity": {
      const identity = localIdentity();
      return {
        handled: true,
        result: {
          pubkey: identity.pubkey,
          display_name: identity.username,
          storage: "ephemeral",
          lost: false,
          locked: false,
        },
      };
    }
    case "sign_event":
      return { handled: true, result: signedEvent(args) };
    case "create_auth_event": {
      if (!args || typeof args !== "object") throw new Error("Missing auth payload");
      const input = args as Record<string, unknown>;
      const relayUrl = requiredText(input.relayUrl, "relay URL");
      const challenge = requiredText(input.challenge, "relay challenge");
      return {
        handled: true,
        result: signedEvent(
          {
            content: "",
            tags: [
              ["relay", relayUrl],
              ["challenge", challenge],
            ],
          },
          22242,
        ),
      };
    }
    case "apply_workspace": {
      const relayUrl = requiredText(
        args && typeof args === "object"
          ? (args as Record<string, unknown>).relayUrl
          : undefined,
        "relay URL",
      );
      if (relayUrl !== DOBIUS_RELAY_WEBSOCKET_URL) {
        throw new Error(
          `Dobius Communications requires ${DOBIUS_RELAY_WEBSOCKET_URL}; received ${relayUrl}`,
        );
      }
      return { handled: true, result: undefined };
    }
    case "validate_repos_dir":
      // Repository roots belong to Dobius and are selected through repo/worktree
      // bindings, never through Buzz's independent filesystem preference.
      return { handled: true, result: undefined };
    case "get_relay_http_url":
      return { handled: true, result: DOBIUS_RELAY_HTTP_URL };
    case "get_relay_ws_url":
      return { handled: true, result: DOBIUS_RELAY_WEBSOCKET_URL };
    case "get_channels":
      return { handled: true, result: await loadRelayChannels() };
    case "get_channel_members":
      return { handled: true, result: await loadDobiusChannelMembers(args) };
    case "get_feed":
      return { handled: true, result: await loadRelayFeed(args) };
    case "get_event":
      return { handled: true, result: await getDobiusEvent(args) };
    case "get_thread_replies":
      return { handled: true, result: await getDobiusThreadReplies(args) };
    case "search_messages":
      return { handled: true, result: await searchDobiusMessages(args) };
    case "get_profile":
      return { handled: true, result: await loadDobiusProfile() };
    case "update_profile":
      return { handled: true, result: await updateDobiusProfile(args) };
    case "get_user_profile": {
      const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
      const pubkey = typeof input.pubkey === "string" ? input.pubkey : localIdentity().pubkey;
      return { handled: true, result: await loadDobiusUserProfile(pubkey) };
    }
    case "get_users_batch":
      return { handled: true, result: await loadDobiusUsersBatch(args) };
    case "search_users":
      return { handled: true, result: await searchDobiusUsers(args) };
    case "open_dm":
      return { handled: true, result: await openDobiusDm(args) };
    case "send_channel_message":
      return { handled: true, result: await sendDobiusChannelMessage(args) };
    case "edit_message":
      await editDobiusMessage(args);
      return { handled: true, result: undefined };
    case "delete_message":
      await deleteDobiusMessage(args);
      return { handled: true, result: undefined };
    case "add_reaction":
      await addDobiusReaction(args);
      return { handled: true, result: undefined };
    case "remove_reaction":
      await removeDobiusReaction(args);
      return { handled: true, result: undefined };
    case "set_prevent_sleep_active":
      // The parent Dobius window owns system power assertions. The embedded
      // renderer cannot acquire an independent Tauri power blocker.
      return { handled: true, result: undefined };
    case "reconcile_managed_agent_runtimes":
    case "list_managed_agent_runtimes":
      // Dobius runs agents through its own run lifecycle rather than persistent
      // buzz-acp child processes. Runtime state is projected by agent.runs.
      return { handled: true, result: [] };
    case "discover_acp_providers":
      return { handled: true, result: await discoverDobiusAgentRuntimes() };
    case "discover_agent_models":
      // Dobius passes the saved model directly to its native engine. An empty
      // successful catalog lets Buzz use each engine's account-level default.
      return {
        handled: true,
        result: {
          agentName: "Dobius native agent",
          agentVersion: "1",
          models: [],
          agentDefaultModel: null,
          selectedModel: null,
          supportsSwitching: false,
        },
      };
    case "list_managed_agents":
      return { handled: true, result: await loadDobiusManagedAgents() };
    case "start_managed_agent":
      return { handled: true, result: await startDobiusManagedAgent(args) };
    case "stop_managed_agent":
      return { handled: true, result: await stopDobiusManagedAgent(args) };
    case "create_managed_agent":
      return { handled: true, result: await createDobiusManagedAgent(args) };
    case "list_personas":
      return { handled: true, result: await loadDobiusPersonas() };
    case "create_persona":
      return { handled: true, result: await createDobiusPersona(args) };
    case "update_persona":
      return { handled: true, result: await updateDobiusPersona(args) };
    case "delete_persona": {
      const id = requiredText(
        args && typeof args === "object"
          ? (args as Record<string, unknown>).id
          : undefined,
        "agent id",
      );
      await invokeDobiusRuntime("agent.delete", { id });
      return { handled: true, result: undefined };
    }
    case "list_teams":
      // Dobius has no persistent team entity yet. Return the authoritative
      // empty state so upstream E2E fixtures can never leak into production.
      return { handled: true, result: [] };
    case "create_channel":
      return { handled: true, result: await createDobiusChannel(args) };
    case "get_channel_details":
      return { handled: true, result: await getDobiusChannelDetails(args) };
    case "update_channel":
      return { handled: true, result: await updateDobiusChannel(args) };
    case "set_channel_topic":
      await updateDobiusChannel(args);
      return { handled: true, result: undefined };
    case "set_channel_purpose":
      await updateDobiusChannel(args);
      return { handled: true, result: undefined };
    case "archive_channel":
      await setDobiusChannelArchived(args, true);
      return { handled: true, result: undefined };
    case "unarchive_channel":
      await setDobiusChannelArchived(args, false);
      return { handled: true, result: undefined };
    case "delete_channel":
      await deleteDobiusChannel(args);
      return { handled: true, result: undefined };
    case "join_channel":
      await joinDobiusChannel(args);
      return { handled: true, result: undefined };
    case "leave_channel":
      await leaveDobiusChannel(args);
      return { handled: true, result: undefined };
    case "add_channel_members":
      return { handled: true, result: await addDobiusChannelMembers(args) };
    case "remove_channel_member":
      await removeDobiusChannelMember(args);
      return { handled: true, result: undefined };
    case "change_channel_member_role":
      await changeDobiusChannelMemberRole(args);
      return { handled: true, result: undefined };
    case "ensure_starter_channels":
      return { handled: true, result: await ensureDobiusStarterChannels() };
    case "get_channel_window":
      return { handled: true, result: await getDobiusChannelWindow(args) };
    default:
      return { handled: false };
  }
}
