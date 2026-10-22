# FIXER Telegram runtime packaging correction — 2026-10-16

## Result

Added the two explicit packaged main-runtime roots, `teleproto` and `big-integer`, to the existing runtime package collector. The collector still walks each package's declared dependencies; the mandatory verifier is unchanged and still fails when a bare external import is absent from copied `Resources/node_modules`.

The new integration regression calls the real `createPackagedRuntimeNodeModuleResources()` function, reads installed package manifests to calculate the transitive declared dependency closure of both roots, copies each corresponding returned resource descriptor into a temporary `Resources/node_modules` tree, and verifies the staged package manifests match their actual source names and versions. A separate negative regression confirms an omitted `teleproto` import is rejected by `verifyPackagedMainRuntimeDeps`.

Installed package metadata was read with Node v24.18.0: `teleproto@1.230.0` declares `big-integer@^1.6.48`, `cifrante@0.5.1`, `mime@^3.0.0`, `node-localstorage@^2.2.1`, `socks@^2.6.2`, and `store2@^2.13.0`; installed `big-integer` is `1.6.52` and declares no dependencies. The staging regression follows all transitively declared dependencies from those installed manifests. No dependency or lockfile version changed.

## Validation

Node v24.18.0, Vitest 4.1.5:

- Full focused file: `/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts config/scripts/electron-builder-config.test.mjs --maxWorkers=1 --reporter=dot` — exit 1, 19 passed / 4 failed / 23 total. The four failures are outside this correction: Linux `StartupWMClass` expected `dobius` but config returns `dobius-ide`; Linux AppImage expected `dobius-linux.${ext}` but config returns `dobius-plus-linux.${ext}`; arm64 AppImage expected `dobius-linux-arm64.${ext}` but config returns `dobius-plus-linux-arm64.${ext}`; executable-bit test observed mode 0 for the temporary launcher. No unrelated config or assertions were changed.
- New regressions: `/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts config/scripts/electron-builder-config.test.mjs --maxWorkers=1 --reporter=dot -t 'stages the Telegram SDK roots|rejects a bare main runtime import'` — exit 0, 2 passed / 21 skipped.
- `pnpm exec oxfmt --check config/packaged-runtime-node-modules.cjs config/scripts/electron-builder-config.test.mjs` — PASS.
- `pnpm exec oxlint config/packaged-runtime-node-modules.cjs config/scripts/electron-builder-config.test.mjs` — PASS.

No full build/package was run by FIXER. ROOT owns the rebuild after independent review. The prior build's mandatory verifier failure remains unrepaired in any generated `dist` output; no manual dist repair or app install was attempted.

## Frozen source

- `dobius/config/packaged-runtime-node-modules.cjs` — SHA-256 `12e7802581d80bde9189a493bfedc190c8174efdfa37155bb85885df137e6aa2`, 15140 bytes
- `dobius/config/scripts/electron-builder-config.test.mjs` — SHA-256 `655e90bd544fcbddf95a3d92cf0f085873820a62bd8e22f27f6db8fdac6153c3`, 20916 bytes

Task `task_905a2e437da3`, dispatch `ctx_549ca304bfa0`; ROOT `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54`, runtime `6627a505-a9ea-4b59-90e7-d051eb153516`. Only the two assigned packaging source/test files, this FIXER report, and FIXER's own `fixer.json` receipt were changed. No accepted Telegram feature files, other build configuration, dependencies/lockfiles, installed app, services, or accounts were changed. This is a source correction with focused test evidence, not packaged or live acceptance. AWS remains deferred and historical Storage paused.
