# REPAIR: speech catalog understates model download sizes

## Symptom

The Settings speech-model picker shows a size next to each model. For the four
largest models that number is far too small, so a model is chosen on the belief
it is a fraction of its real cost. This is how Parakeet TDT v3 got selected on a
machine that cannot load it — the picker said 180 MB.

## Root cause

`sizeBytes` in `src/main/speech/model-catalog.ts` was hand-entered rather than
measured for the large models. Verified by HTTP HEAD against each `downloadUrl`
(Content-Length, following redirects), 2026-09-05:

| id | declared | actual archive | error |
|---|---|---|---|
| paraformer-bilingual-zh-en | 115 MB | 1047.3 MB | 9.1x |
| zipformer-bilingual-zh-en | 130 MB | 511.3 MB | 3.9x |
| parakeet-tdt-0.6b-v2-int8 | 170 MB | 482.5 MB | 2.8x |
| parakeet-tdt-0.6b-v3-int8 | 180 MB | 487.2 MB | 2.7x |
| zipformer-streaming-en-20m | 128 MB | 127.9 MB | correct |
| zipformer-streaming-zh-14m | 74 MB | 74.0 MB | correct |
| whisper-tiny | 116 MB | 116.2 MB | correct |

The three small entries are accurate to within 0.2%, which is the tell: those
were measured, the large ones were estimated.

Unpacked footprint is larger still — Parakeet v3 is a 487 MB archive that
expands to ~640 MB on disk (622 MB encoder + 12 MB decoder + 6.1 MB joiner).
So even the corrected number understates the disk cost.

## Scope

Change only the four wrong `sizeBytes` values, and document what the field
means. Do NOT:
- change the three correct values
- invent unpacked sizes for models not downloaded (would be guessing)
- touch the download, extraction, or preflight logic

The memory preflight is unaffected: it stats real files on disk and never reads
`sizeBytes`.

## Fix

Set `sizeBytes` to the measured Content-Length for the four wrong entries.
Add a comment on the type stating the field is compressed download size, not
installed size, so the next person does not have to re-derive it.

## Test

`model-catalog-sizes.test.ts` — assert every entry with a `downloadUrl` has a
`sizeBytes`, and that each matches the measured value recorded here. Offline
(no network in tests); the measured values are the fixture.

## Rollback

Single-file value change plus one test file. `git revert` the commit.
