# REPAIR BUILD-044B — Install record outside the signed bundle

Follow-up build (not in EXECUTION-ORDER.md), approved by Carson ("5 fix"). Files: `scripts/install-dobius-gated.sh`,
new `scripts/install-record.py`, `dobius/src/main/jarvis/self-edit-repo-root.ts`, installer test fixtures/suites,
`RELEASING.md`, `WORKSPACE.md`.

## Root cause

`scripts/install-dobius-gated.sh` wrote `INSTALL-PROVENANCE.json` into `Contents/Resources/` of the staged copy
(`PROV_REL`, old :70, written at old :243, validated at old :288) AFTER electron-builder had signed the bundle. That adds
an unsealed file to a sealed bundle: `codesign --verify --deep --strict` fails ("a sealed resource is missing or
invalid", reproduced on an ad-hoc signed fixture), and macOS permission grants tied to the signature (Screen Recording,
Automation) can re-prompt after installs. `BUILD-PROVENANCE.json` (BUILD-044) is added via extraResources before
signing and is left alone.

## Design (simplest correct)

- **Where:** records live in the backups folder, never in `/Applications`:
  - installed app: `$BACKUP_DIR/INSTALL-PROVENANCE.json` (`CURRENT_REC`,
    default `~/Library/Application Support/dobius-plus-install-backups/`);
  - rollback copy: `$BACKUP_DIR/Dobius+.previous.INSTALL-PROVENANCE.json` (`ROLLBACK_REC`, i.e. `<bundle>.INSTALL-PROVENANCE.json`).
- **Keyed to the bundle:** each record gets `bundleIdentity` = sha256 of `Contents/Info.plist` followed by
  `Contents/_CodeSignature/CodeResources` when present (the seal hashes every sealed file, so two signed builds never
  share it; unsigned builds are told apart by CFBundleVersion, the build counter). One Python implementation
  (`scripts/install-record.py identity|find`) and one TS twin (`bundleIdentity` in self-edit-repo-root.ts); a test
  asserts they agree byte for byte.
- **Readers:** a record is used only for the bundle it names; otherwise the legacy in-bundle record is read
  (backward compatibility with installs from before this build). `install-record.py find <bundle> <sidecar>`
  implements this for the installer; `readInstallRecordRepo` for self-edit.
- **Write timing (no record for a bundle that is not installed):** the record is generated at stage time into the
  lock dir (`$LOCK/INSTALL-PROVENANCE.json`, removed on every exit), validated with the stage, and promoted only after
  the new bundle is at `$DEST` (`promote_record`: old `CURRENT_REC` → `ROLLBACK_REC`, pending → same-dir tmp → rename
  to `CURRENT_REC`). The cleanup trap promotes it if a signal lands between the swap and the promotion. The rollback
  record is dropped when the rollback move fails.
- **Rollback pairing:** a rollback (`install-dobius-gated.sh "$ROLLBACK" --take-over --allow-downgrade`) with no
  valid build record takes its source state from its paired record (`sourceStateFrom: "previous-install"`, validated
  by `source-state.py --from-build-record` incl. the buildNumber/CFBundleVersion match) instead of the unrelated tree
  beside the backups folder. The swapped-out bundle's record moves beside the new rollback copy.
- **Safety order unchanged:** lock → helper checks (now incl. install-record.py) → source state → ownership →
  version → stage → validate (incl. manifest) → quit → swap → record promotion → rollback move → cleanup.

## Tests

- `config/scripts/install-dobius-gated-record.test.mjs` (new):
  - ad-hoc **signed** fixture (`makeBundle({ signed: true })`): installed bundle digest (every path, mode, symlink,
    content) equals the build's, and `codesign --verify --deep --strict` passes on the installed app;
  - install → upgrade (`--take-over`) → documented rollback: each record pairs with its bundle, rollback restores
    v2's source state (`previous-install`) and moves v3's record beside the new rollback copy;
  - validation failure (7) and swap failure (8) leave `CURRENT_REC` byte-identical and create no rollback record;
  - ownership: matching outside record → refused (3); record naming another bundle → ignored, legacy in-bundle record
    read (3); `--take-over` installs.
- Existing suites updated: `provenanceOf` now reads `CURRENT_REC`, asserts it names the bundle and that nothing is
  inside the bundle; backups listings include the records; first install creates only the record; the TERM-after-swap
  test (the signal now lands at the record move) asserts the record still lands.
- `dobius/src/main/jarvis/self-edit-repo-root.test.ts` (new): outside record used when it names the bundle; wins over
  a stale in-bundle record; one naming another bundle is ignored → legacy fallback / refusal; a matching record without
  repo refuses; TS and Python identity agree (with and without seal).

### Mutation checks (each run against the targeted suite, file restored after each)

Script: `stabilize-run/044B/mutate.py`; every mutation made its suite FAIL, and `git diff` was byte-clean after restore.

| Mutation | Failing test(s) |
|---|---|
| M1 record also copied into the stage (the old bug) | signed byte-for-byte + codesign; pairing; ownership |
| M2 ownership check ignores the outside record | ownership (record-lane) |
| M3 old record deleted instead of moved beside the rollback | pairing through rollback |
| M4 cleanup trap does not promote the pending record | TERM-after-swap (version suite) |
| M5 rollback does not reuse its paired record | pairing through rollback (`previous-install`) |
| M6 `find` skips the bundleIdentity check | ownership (legacy-lane) |
| M7 record promoted before the swap | failed-install records untouched (+3 others) |
| M8 TS ignores bundleIdentity | outside record of another bundle ignored |
| M9 TS never reads the outside record | 3 outside-record tests |
| M10 TS drops the legacy fallback | legacy fallback test |

## Review round 1 (F1 high, F2 low)

- **F1:** a TERM while the swap `python3` ran was handled as soon as it returned, before `PHASE="swapped"`, so cleanup
  took `$STAGE` (by then the PREVIOUS bundle) for a partial stage and deleted it, and the record was never promoted.
  Fix: from just before the quit through the rollback move, `trap 'SIGNALLED=1' INT TERM` defers INT/TERM; afterwards
  the `exit 130` trap is restored and a deferred signal exits 130 (cleanup relaunches the app). Defence in depth: the
  stage's inode is taken before the quit (`STAGE_INODE`); cleanup treats `prepare` as swapped when `$DEST` has that
  inode, and a swap `python3` that reports failure after the rename (`swapped_in`) no longer exits 8.
  Deviation from the review's suggestion: inode instead of bundleIdentity, because two builds can share an identity
  (unsigned, no build counter, or a same-build reinstall) while the inode names exactly the staged directory; and a
  deferring trap instead of `trap ''` so the signal is not lost.
- **F2:** `promote_record` rotates `CURRENT_REC` → `ROLLBACK_REC` at most once per run (`RECORD_ROTATED`), so a retry from
  cleanup no longer deletes the rollback record; a failed copy removes its tmp file.
- Tests (install-dobius-gated-record.test.mjs): TERM during the swap; TERM right after the rotation; a failed first
  promotion retried by cleanup; a swap reported as failed after it swapped. Merged `stabilize/integration` first.
- Mutation checks (`stabilize-run/044B/mutate2.py`), all FAIL: pre-fix script (all 4 new tests); no deferral (rotation
  test; the swap test is still saved by the cleanup inode check); no deferral and no inode check (both TERM tests);
  rotation unguarded (retry test); swap result not re-checked (swap-reported-failure test); deferred signal never
  honoured (both TERM tests).

## Deviations

- Not in EXECUTION-ORDER.md (follow-up build).
- The installed app's record path does not follow the `<bundle>.INSTALL-PROVENANCE.json` rule because nothing may be
  written into `/Applications`.
- Exit 9 also covers "the installed app's record cannot be looked up" (helper crash) — fail closed instead of skipping
  the ownership check. Documented in RELEASING.md.
- `docs/stabilization/*` (ARCHITECTURE-MAP, BASELINE, SAFETY-GATES) still name the in-bundle path; they are historical
  planning records and were left unchanged.
- External skill `~/.claude/skills/dobius-build-install/SKILL.md:72` still says
  `cat "/Applications/Dobius+.app/Contents/Resources/INSTALL-PROVENANCE.json"`; it should become
  `cat "$HOME/Library/Application Support/dobius-plus-install-backups/INSTALL-PROVENANCE.json"` (not edited here).

## Rollback

Revert the commit. Installs made with this build keep their record outside the bundle; the pre-044B installer and
reader would then find no in-bundle record (ownership check skipped, self-edit off until the next install).

## Lessons

- The Dobius+ fixture bundle can be ad-hoc signed once every nested code item is a real Mach-O (a copy of
  `/bin/echo`) and the framework has `Resources/Info.plist`; that makes `codesign --verify --deep --strict` a real test.
