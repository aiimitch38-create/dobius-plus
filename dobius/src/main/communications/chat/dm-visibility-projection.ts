/**
 * "Hidden DM" list for `hide_dm` (kind 30622, addressable with no `d` tag —
 * one replaceable-per-author snapshot). Already read by the shipped
 * `loadRelayChannels` (backs `get_channels`) in
 * vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts: it queries
 * `{ kinds: [30622], "#p": [selfPubkey] }` and treats every `h` tag on the
 * latest event as a hidden DM channel id. `hide_dm` is the writer side of
 * that same event — it must keep the `p` self-tag (so the existing reader
 * keeps finding it) and fold the newly hidden id into the existing set
 * rather than clobbering previously hidden DMs.
 */

const HIDDEN_DM_TAG = 'h'

export function hiddenDmChannelIdsFromTags(tags: readonly string[][]): string[] {
  return tags.filter((tag) => tag[0] === HIDDEN_DM_TAG && Boolean(tag[1])).map((tag) => tag[1])
}

/** Builds the full replacement tag set for a new hide-DM snapshot event. */
export function buildHiddenDmSnapshotTags(selfPubkey: string, existingTags: readonly string[][], channelIdToHide: string): string[][] {
  const hidden = new Set(hiddenDmChannelIdsFromTags(existingTags))
  hidden.add(channelIdToHide)
  return [['p', selfPubkey.trim().toLowerCase()], ...[...hidden].sort().map((id) => [HIDDEN_DM_TAG, id])]
}
