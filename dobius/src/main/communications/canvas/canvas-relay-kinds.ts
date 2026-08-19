/**
 * Nostr event kinds this family (canvas + social notes) publishes onto the
 * Dobius relay (src/main/communications/relay/). Centralized here so the
 * renderer-side case blocks this family reports for
 * vendor/buzz-desktop/.../dobiusCommunications.ts (a shared file this
 * family does not edit directly — see the WIRING RULE) and this directory's
 * own tests agree on one set of numbers.
 *
 * Collision audit performed against every literal `kind` in
 * vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts and every
 * src/main/communications/**\/*.ts file at the time these were picked
 * (0, 1, 2, 3, 5, 7, 9, 9005, 9030, 9035, 9036, 10002, 13534, 13535, 22242,
 * 24200, 30078, 30622, 39000, 39002, 40002, 40003, 41010, 44200, 45001,
 * 45003 were all already spoken for). Re-audit before reusing either number
 * for anything else.
 */

/**
 * Per-channel collaborative canvas document. Addressable (NIP-33 style,
 * kind in [30000, 40000)) so RelayStore collapses repeated writes to the
 * newest one per (pubkey, kind, d-tag) — exactly the "one live canvas per
 * channel" semantics `set_canvas` needs — keyed by the channel id as the
 * `d` tag, the same convention channel metadata (kind 39000) and channel
 * membership (kind 39002) already use.
 */
export const DOBIUS_CANVAS_KIND = 30011

/**
 * A social "note" (global microblog-style post — publish_note/get_notes_*),
 * distinct on purpose from kind 1, which DOBIUS_CHANNEL_MESSAGE_KINDS in
 * dobiusCommunications.ts already overloads for in-channel chat (always
 * carrying an "h" tag). RelayFilter has no tag-negation, so a global notes
 * query (kinds:[1], no #h filter) would otherwise return every channel
 * message too. Deliberately a plain, non-replaceable, non-addressable kind
 * (not in [0,3], not in [10000,20000), not in [30000,40000)) — each
 * publish_note call must create a new, independent event, never replace an
 * author's earlier notes the way a replaceable/addressable kind would.
 */
export const DOBIUS_NOTE_KIND = 1111

/** Reactions to notes reuse the existing NIP-25 kind 7 mechanism that
 * add_reaction/remove_reaction already publish for channel messages — a
 * reaction is a reaction regardless of what kind of event it targets, so
 * introducing a second reaction kind here would just split one concept in
 * two for no benefit. */
export const DOBIUS_REACTION_KIND = 7
