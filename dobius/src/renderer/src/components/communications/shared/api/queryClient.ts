import { QueryClient } from "@tanstack/react-query";

/**
 * Module singletons, like app/router.tsx: the whole comms subtree unmounts on
 * every Dobius+ tab switch, and per-mount QueryClients threw away every cache
 * (channel window, thread replies) each time — returning to a thread showed it
 * empty until a refetch landed. Community switches still get a fresh client
 * (keyed map below), which is the reset the upstream window-reload provided.
 */
export const buzzQueryClient = createBuzzQueryClient();

const communityQueryClients = new Map<string, QueryClient>();

export function getCommunityQueryClient(communityKey: string): QueryClient {
  let client = communityQueryClients.get(communityKey);
  if (!client) {
    client = createBuzzQueryClient();
    communityQueryClients.set(communityKey, client);
  }
  return client;
}

export function createBuzzQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        networkMode: "always",
        gcTime: 5 * 60 * 1_000,
      },
      mutations: {
        networkMode: "always",
      },
    },
  });
}
