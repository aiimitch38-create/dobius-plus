/**
 * Preset-logo coverage guard.
 *
 * The in-house Electron integration owns runtime discovery. This test therefore
 * validates the frontend-owned logo catalog directly instead of coupling the
 * UI to the removed Tauri preset implementation.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RUNTIME_MARKS } from "./HarnessMarks.tsx";
import { PRESET_LOGOS } from "./RuntimeIcon.tsx";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const presetIds = Object.keys(PRESET_LOGOS);

for (const id of presetIds) {
  test(`preset "${id}" has a bundled logo or inline mark`, () => {
    // Inline SVG marks (RUNTIME_MARKS) take precedence over bitmap logos —
    // e.g. Cursor's mark ships as an inline CC0 simple-icons path, not a
    // file under desktop/public.
    if (RUNTIME_MARKS[id]) {
      return;
    }
    const logoPath = PRESET_LOGOS[id];
    assert.ok(
      logoPath,
      `preset "${id}" has no RUNTIME_MARKS or PRESET_LOGOS entry — it renders ` +
        `the generic TerminalSquare fallback. Add desktop/public${logoPath ?? `/harness-logos/${id}.png`} ` +
        `and map it in RuntimeIcon.tsx.`,
    );
    assert.ok(
      existsSync(path.join(desktopRoot, "public", logoPath)),
      `PRESET_LOGOS["${id}"] points at ${logoPath}, which is missing from ` +
        `desktop/public — RuntimeIcon's onError would silently fall back.`,
    );
  });
}

test("the frontend preset logo catalog is not accidentally empty", () => {
  assert.ok(presetIds.length >= 8);
});

test("codex ships no bundled mark or logo (vendor-removed OpenAI blossom)", () => {
  // The OpenAI blossom was removed from simple-icons v16 at the vendor's
  // request — Codex must render RuntimeIcon's neutral terminal-glyph
  // fallback, not a re-bundled copy of the withdrawn mark.
  assert.equal(
    RUNTIME_MARKS.codex,
    undefined,
    "codex has a RUNTIME_MARKS entry — the OpenAI blossom must not ship without explicit approval",
  );
  assert.equal(
    PRESET_LOGOS.codex,
    undefined,
    "codex has a PRESET_LOGOS entry — no bundled Codex logo is approved",
  );
});
