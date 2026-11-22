# PORT: What's new popup

Status: PARTLY PRESENT. The updater has a changelog card, but there is no "What's new after you updated" popup and no per-version notes files. Grep for "whatsNew", "what's new", "release notes", "changelog" in `dobius/src` finds only the updater pieces below.

## What it does for the user
After an update, the first window you focus shows "What's new in Dobius+ <version>" once: a few plain-English lines. Close it with Continue, Enter or Escape. A fresh install shows nothing. If you skipped several versions you see every skipped version's notes (up to 10). Settings keeps the notes on the Updates page.

## Sam's source (repo `statusdigitalmarketing/dobius-plus`, JavaScript app)
- Feature commit `79bb86ed`, merged `36b175f1` (branch `feat/whats-new`, no PR number). Follow-up PR #8 / `a2d65384` "What's new lists every skipped version". Release-notes wording: PR #11 / #16 / #17 ("say this computer, not the Mac").
- Per-release note commits: `21b54e78` (2.2.40) and the series before it.
- His files: `electron/whats-new.js` (picks which window shows it, remembers seen version), `electron/whats-new-notes.js` (parses `electron/whats-new/<version>.md`), `electron/whats-new/*.md`, `src/components/shared/WhatsNew.jsx`, `src/components/Dashboard/Updates.jsx`, `scripts/whats-new-check.mjs` (release refuses without valid notes), `electron/__tests__/whats-new.test.mjs` (11 tests), `src/App.jsx`, `src/store/store.js`, `config-manager.js`.
- His lessons: save "seen" as an object (renderer whole-config saves copy only scalars); never lower it on a downgrade; off in dev on shared user data; popup must own the keyboard (other key handlers check a flag); a long list must scroll (flex min-height 0).

## Where it fits in THIS app (under `dobius/src`)
Reuse:
- `main/updater-changelog.ts` and `shared/types.ts` (`ChangelogData`, `ChangelogRelease`): already fetches release info with title, description, media and `releaseNotesUrl`. This is a remote source; Sam's is local files shipped in the app. Decide which to use (Open question 1).
- `renderer/src/components/UpdateCard.tsx`: shows the changelog before an update is installed.
- `renderer/src/components/settings/GeneralUpdateSettingsSection.tsx`: add the notes list here.
- `main/persistence.ts`: store `whatsNew.seen` (last seen version).
- `main/index.ts` (`app.getVersion()`): compare with seen at startup.
- Dialog: `renderer/src/components/confirmation-dialog.tsx` or the `ui/` dialog primitives for the popup shell.
New: `main/whats-new.ts`, notes folder (suggest `dobius/resources/whats-new/<version>.md`, bundled), `renderer/src/components/WhatsNewDialog.tsx`, release check script.

## Port steps
1. S. Notes format: one short markdown file per version, plain English (use Carson's communication rules). Parser `main/whats-new-notes.ts` with tests; collect every version between seen and current, cap 10.
2. S. Persisted `whatsNew.seen` (object), first run records baseline and shows nothing; never decreases.
3. M. Main `main/whats-new.ts`: choose the focused window that reported ready, only after window restore finishes; hand back if another overlay holds the keyboard, focus is lost, or the page reloads; no popup in dev. Port his 11 tests.
4. S. IPC + preload.
5. M. `WhatsNewDialog.tsx`: Continue/Enter/Escape, scrollable, takes keyboard focus so other shortcuts do not fire behind it.
6. S. Add the same notes to the Updates settings section.
7. S. Release gate script that fails when notes for the new version are missing (mirror `whats-new-check.mjs`; look at how this repo releases first).
8. S. Write the first notes file for 2.1.x.

Total: M (about 1 to 1.5 days).

## How to test in the dev copy
In the isolated dev copy set `seen` to an older version in its own user-data folder, launch, and confirm the popup appears once with all skipped versions. Press Enter: it closes and does not return after reload. Fresh user data: nothing shows. Hold a command palette open at launch: popup waits. Add 12 fake versions to see the 10 cap and scrolling. Screenshot in a fresh window.

## Open questions for Carson
1. Notes from local files (Sam) or from the GitHub release via `updater-changelog.ts`? Recommended: local files, so it works offline and you write the words.
2. Should it block with a modal, or be a small toast with a "See what's new" link? Recommended: modal like Sam's, dismiss on Enter.
3. Who writes the notes each release? Recommended: the release step refuses without them, as Sam did.
