/**
 * Presence for `get_presence`. Dobius has no dedicated presence/heartbeat
 * event kind, so presence is inferred from a pubkey's most recent authored
 * event on the relay (a real, relay-backed signal — not a fabricated
 * constant): recently active is "online", active within the last half hour
 * is "away", anything older (or no event at all) is "offline".
 */

export type PresenceStatus = 'online' | 'away' | 'offline'

export const PRESENCE_ONLINE_WINDOW_SECONDS = 5 * 60
export const PRESENCE_AWAY_WINDOW_SECONDS = 30 * 60

export function presenceStatusFromLastSeen(lastSeenCreatedAt: number | null, nowSeconds: number): PresenceStatus {
  if (lastSeenCreatedAt === null) {
    return 'offline'
  }

  const age = nowSeconds - lastSeenCreatedAt
  if (age <= PRESENCE_ONLINE_WINDOW_SECONDS) {
    return 'online'
  }
  if (age <= PRESENCE_AWAY_WINDOW_SECONDS) {
    return 'away'
  }
  return 'offline'
}
