# Laya runtime recovery and verification

The original user fork is recovered on the VPS at
`/srv/dobius/components/laya-3cf26cbc`, pinned to
`3cf26cbcb18725dbc2d127bb8bb2c4c43243ae63`. Its tracked working tree is clean.
The isolated runtime is `/srv/dobius/components/laya-runtime-3cf26cbc`, using
Python 3.12.3, CPU-only Torch 2.6.0, Transformers 4.57.6 and Laya 0.4.0.
The full resolved dependency lock is retained beside that runtime and in the
local private recovery receipts. No dependency was installed globally.

The public multilingual checkpoint is pinned to Hugging Face revision
`7b928d828b7b0e022f929d9bd2e44165aa270148`. Only its five files were recovered,
inside `/srv/dobius/components/laya-state-3cf26cbc/cache`; the laptop and failed
Storage volume are not model-cache locations. Verified SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| Model safetensors, 643835514 bytes | `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204` |
| Tokenizer JSON, 34363188 bytes | `609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f` |

## Verified evidence

The isolated runtime passes `pip check`, real imports, the fork's required Ruff
rules and compileall. Its standalone MCP suite passes 957 checks, its standalone
portability suite passes 39 checks, and its HTTP pytest suite passes 252 tests.
MCP and portability scripts exit at module level; importing them into pytest
produces a collection error. That failed invocation is preserved, and the
corrected commands run those suites as scripts.

A temporary CPU probe loaded the real pinned checkpoint offline and classified
three fixed synthetic build-status examples. Loading took about 14.7 seconds;
the three predictions took 328, 285 and 263 milliseconds. Measured maximum process
RSS was 2305368064 bytes. These three examples establish that inference executes;
they are not a production accuracy, calibration, or human-labeling evaluation.

The probe ran as the `dobius` user in a temporary systemd unit with requested
2300 MiB memory, one-CPU and 180-second limits. It exited successfully and was
collected. The systemd summary's memory-peak counter differs substantially from
the measured process RSS; do not use that summary as a proved memory-containment
receipt. Metro, the existing Dobius server and speech service remained active.

Private receipt scripts and JSON are under
`~/Documents/Dobius Recovery/cloud-workstation-20261013/` on the laptop; the
VPS retains the pinned-model receipt, dependency lock and separate test logs.
Receipts contain synthetic inputs only, with no personal notes or credentials.

## Remaining activation gates

No persistent Laya service, API secret, MCP client registration, production
authority adapter, evaluated advisory gate or application provider has been
activated by this recovery. The existing advisory foundation remains unavailable
until its real gates pass; see [LAYA-ADVISORY.md](LAYA-ADVISORY.md).

Before activation, verify one authenticated loopback backend shared by lightweight
MCP adapters, two-client readback, exact revision and request binding, outage
handling, bounded inference, meaningful held-out evaluation and calibration.
Measure steady-state and peak memory with the existing services and the two
Hermes workers. Heavy builds must respect that measured capacity. The runtime
must never load separate models per terminal or pass note previews to inference.
Keep model advice separate from deterministic permissions, cleanup, acceptance
and job authority. AWS remains deferred; no archive deletion is enabled.
