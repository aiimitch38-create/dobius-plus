import { invokeTauri } from "@comms/shared/api/tauri";
import {
  invokeDobiusRuntime,
  isDobiusCommunicationsAvailable,
} from "@comms/shared/api/dobiusCommunications";
import type {
  AgentTeam,
  ConnectedDobiusAccount,
  CreateTeamInput,
  UpdateTeamInput,
} from "@comms/shared/api/types";

type RawTeam = {
  id: string;
  name: string;
  description: string | null;
  instructions?: string | null;
  persona_ids: string[];
  /** Optional for back-compat with a wire payload from before this field existed. */
  account_ids?: string[];
  is_builtin?: boolean;
  source_dir?: string | null;
  is_symlink?: boolean;
  symlink_target?: string | null;
  version?: string | null;
  created_at: string;
  updated_at: string;
};

export function fromRawTeam(team: RawTeam): AgentTeam {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    instructions: team.instructions ?? null,
    personaIds: team.persona_ids,
    accountIds: team.account_ids ?? [],
    isBuiltin: team.is_builtin ?? false,
    sourceDir: team.source_dir ?? null,
    isSymlink: team.is_symlink ?? false,
    symlinkTarget: team.symlink_target ?? null,
    version: team.version ?? null,
    createdAt: team.created_at,
    updatedAt: team.updated_at,
  };
}

export async function listTeams(): Promise<AgentTeam[]> {
  return (await invokeTauri<RawTeam[]>("list_teams")).map(fromRawTeam);
}

export async function createTeam(input: CreateTeamInput): Promise<AgentTeam> {
  return fromRawTeam(
    await invokeTauri<RawTeam>("create_team", {
      input: {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        personaIds: input.personaIds,
        accountIds: input.accountIds,
      },
    }),
  );
}

export async function updateTeam(input: UpdateTeamInput): Promise<AgentTeam> {
  return fromRawTeam(
    await invokeTauri<RawTeam>("update_team", {
      input: {
        id: input.id,
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        personaIds: input.personaIds,
        accountIds: input.accountIds,
      },
    }),
  );
}

function labelForEngineAccount(engineLabel: string, email: string | null) {
  return email ? `${engineLabel} · ${email}` : `${engineLabel} account`;
}

/** Reads one engine's slice of the accounts.list snapshot (`{ accounts: [...] }`). */
function connectedAccountsForEngine(
  engineLabel: string,
  engineState: unknown,
): ConnectedDobiusAccount[] {
  if (!engineState || typeof engineState !== "object") return [];
  const accounts = (engineState as Record<string, unknown>).accounts;
  if (!Array.isArray(accounts)) return [];

  const result: ConnectedDobiusAccount[] = [];
  for (const candidate of accounts) {
    if (!candidate || typeof candidate !== "object") continue;
    const account = candidate as Record<string, unknown>;
    if (typeof account.id !== "string") continue;
    const email = typeof account.email === "string" ? account.email : null;
    result.push({ id: account.id, label: labelForEngineAccount(engineLabel, email) });
  }
  return result;
}

/**
 * Connected Claude/Codex accounts a team's agents can run under. Reads the
 * same `accounts.list` RPC method dobiusCommunications.ts's ACP runtime
 * catalog projection uses, but takes the raw `ClaudeManagedAccountSummary`/
 * `CodexManagedAccountSummary.id` (a randomUUID, see src/shared/types.ts)
 * directly — team.accountIds must hold that same bare id (what
 * team-store.ts's normalizeAccountIds() expects), not the catalog's
 * composite `dobius:<engine>:<accountId>` runtime-selection id, which is a
 * different namespace used for persona harness selection. Only id + email
 * ever cross this boundary — never a credential.
 */
export async function listConnectedAccounts(): Promise<
  ConnectedDobiusAccount[]
> {
  if (!isDobiusCommunicationsAvailable()) {
    return [];
  }
  const snapshot = await invokeDobiusRuntime("accounts.list");
  if (!snapshot || typeof snapshot !== "object") return [];
  const record = snapshot as Record<string, unknown>;
  return [
    ...connectedAccountsForEngine("Claude", record.claude),
    ...connectedAccountsForEngine("Codex", record.codex),
  ];
}

export async function deleteTeam(id: string): Promise<void> {
  await invokeTauri("delete_team", { id });
}

// ── Team snapshot types ─────────────────────────────────────────────────────

export type SnapshotFormat = "json" | "png";
export type SnapshotMemoryLevel = "none" | "core" | "everything";

export type EncodedTeamSnapshotPayload = {
  fileBytes: number[];
  fileName: string;
};

export type TeamSnapshotMemberPreview = {
  displayName: string;
  systemPrompt: string | null;
  avatarUrl: string | null;
  hasSourceAllowlist: boolean;
  sourceAllowlistCount: number;
};

export type TeamSnapshotImportPreview = {
  name: string;
  description: string | null;
  instructions: string | null;
  members: TeamSnapshotMemberPreview[];
  hasSourceAllowlist: boolean;
};

export type TeamSnapshotImportConfirm = {
  fileBytes: number[];
  keepAllowlist: boolean;
};

export type TeamSnapshotImportMemberResult = {
  displayName: string;
  pubkey: string;
  personaId: string;
  memoryWritten: number;
  memoryTotal: number;
  memoryErrors: string[];
  profileSyncError: string | null;
};

/** Wire shape of the nested `TeamRecord` — Rust has no `rename_all` so fields
 *  arrive in snake_case, matching the existing `RawTeam` convention. */
type RawTeamRecord = {
  id: string;
  name: string;
  description: string | null;
  persona_ids: string[];
  instructions: string | null;
  is_builtin: boolean;
  source_dir: string | null;
  is_symlink: boolean;
  symlink_target: string | null;
  version: string | null;
  created_at: string;
  updated_at: string;
};

/** Raw wire shape of the import result — outer struct is camelCase,
 *  but the nested `team` field is snake_case (no `rename_all` on TeamRecord). */
type RawTeamSnapshotImportResult = {
  team: RawTeamRecord;
  personaIds: string[];
  members: TeamSnapshotImportMemberResult[];
};

export type TeamSnapshotImportResult = {
  team: AgentTeam;
  personaIds: string[];
  members: TeamSnapshotImportMemberResult[];
};

// ── Team snapshot commands ───────────────────────────────────────────────────

export async function exportTeamSnapshot(
  id: string,
  memoryLevel: SnapshotMemoryLevel,
  format: SnapshotFormat,
): Promise<boolean> {
  return invokeTauri<boolean>("export_team_snapshot", {
    id,
    memoryLevel,
    format,
  });
}

export async function encodeTeamSnapshotForSend(
  id: string,
  memoryLevel: SnapshotMemoryLevel,
  format: SnapshotFormat,
): Promise<EncodedTeamSnapshotPayload> {
  return invokeTauri<EncodedTeamSnapshotPayload>(
    "encode_team_snapshot_for_send",
    {
      id,
      memoryLevel,
      format,
    },
  );
}

export async function previewTeamSnapshotImport(
  fileBytes: number[],
  fileName: string,
): Promise<TeamSnapshotImportPreview> {
  return invokeTauri<TeamSnapshotImportPreview>(
    "preview_team_snapshot_import",
    {
      fileBytes,
      fileName,
    },
  );
}

export async function confirmTeamSnapshotImport(
  input: TeamSnapshotImportConfirm,
): Promise<TeamSnapshotImportResult> {
  const raw = await invokeTauri<RawTeamSnapshotImportResult>(
    "confirm_team_snapshot_import",
    { input },
  );
  return {
    team: fromRawTeam(raw.team),
    personaIds: raw.personaIds,
    members: raw.members,
  };
}
