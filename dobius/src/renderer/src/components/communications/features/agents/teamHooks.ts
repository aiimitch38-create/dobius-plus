import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createTeam,
  deleteTeam,
  listConnectedAccounts,
  listTeams,
  updateTeam,
} from "@comms/shared/api/tauriTeams";
import type {
  AgentTeam,
  CreateTeamInput,
  UpdateTeamInput,
} from "@comms/shared/api/types";

export const teamsQueryKey = ["teams"] as const;
export const connectedAccountsQueryKey = ["dobius-connected-accounts"] as const;

/** Connected Claude/Codex accounts available to bind a team to (see tauriTeams.listConnectedAccounts). */
export function useConnectedAccountsQuery() {
  return useQuery({
    queryKey: connectedAccountsQueryKey,
    queryFn: listConnectedAccounts,
    staleTime: 30_000,
  });
}

export function useTeamsQuery() {
  return useQuery({
    queryKey: teamsQueryKey,
    queryFn: listTeams,
    staleTime: 30_000,
    // No refetchInterval: inbound relay team changes emit `agents-data-changed`
    // (handled by useAgentsDataRefresh). Same redundant-poll removal as
    // usePersonasQuery.
  });
}

export function useCreateTeamMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTeamInput) => createTeam(input),
    onSuccess: (created) => {
      queryClient.setQueryData<AgentTeam[]>(teamsQueryKey, (current) => {
        const next = current ?? [];
        return [created, ...next.filter((team) => team.id !== created.id)];
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: teamsQueryKey });
    },
  });
}

export function useUpdateTeamMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateTeamInput) => updateTeam(input),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: teamsQueryKey });
    },
  });
}

export function useDeleteTeamMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: teamsQueryKey });
    },
  });
}
