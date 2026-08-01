/**
 * Friendly display name for a Claude model id, derived from the family + version
 * so it never goes stale as new versions ship (unlike a hardcoded id->label map).
 *
 * Handles BOTH naming orders:
 *   claude-opus-4-8            -> "Opus 4.8"    (new: family then version)
 *   claude-fable-5             -> "Fable 5"
 *   claude-haiku-4-5-20251001  -> "Haiku 4.5"   (trailing 8-digit date ignored)
 *   claude-3-5-sonnet-20241022 -> "Sonnet 3.5"  (old: version then family)
 *   claude-3-opus-20240229     -> "Opus 3"
 *
 * Only strings that start with "claude-" and contain a known family are labeled;
 * anything else (a proxy id, a non-Claude agent model) returns the raw id so it
 * is never mislabeled.
 */
const FAMILY_RE = /^(fable|opus|sonnet|haiku)$/i;

export function modelLabel(id) {
  if (!id || typeof id !== 'string') return '';
  const segs = id.split('-');
  if (segs[0].toLowerCase() !== 'claude') return id; // not a Claude id
  const fam = segs.find((s) => FAMILY_RE.test(s));
  if (!fam) return id; // claude-* but unknown family
  const family = fam[0].toUpperCase() + fam.slice(1).toLowerCase();
  // Version parts are the short numeric segments (major, minor). An 8-digit
  // date suffix has >2 digits so it is excluded. Works regardless of whether the
  // numbers precede or follow the family segment.
  const nums = segs.filter((s) => /^\d{1,2}$/.test(s)).slice(0, 2);
  return nums.length ? `${family} ${nums.join('.')}` : family;
}
