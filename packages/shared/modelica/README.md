# Modelica CLI + OMC Trace Runbook

This package contains the JS Modelica CLI and helper scripts to generate OMC reference traces for MSL examples.

## Prerequisites

- `podman` installed and runnable
- `cargo` available
- Network access for first-time dependency/image/MSL downloads

## Main Script

- Script: `packages/shared/modelica/scripts/generate-omc-traces-via-podman.sh`
- Wrapper used for `omc`: `packages/shared/modelica/scripts/omc-via-podman.sh`

## Primary Runtime-Debug Tactic (Mandatory First Step)

When a model compiles but runtime or solver behavior is wrong, AI agents **must start with a generated pure JS model first**.
Do not jump directly to solver, template, compiler, or repo-source edits until this loop has been attempted and documented on the generated JS artifact itself.

This is a hard requirement.
It is not optional.
It is not "preferred".
It is not "good enough" to only inspect diagnostics output and then edit `javascript.jinja` or `simulateModel.js`.
AI agents must treat this as a blocking gate.
Until the generated-JS repro and generated-JS fix steps are done, repo source edits are out of bounds for runtime-debug work.

For every runtime-debug iteration, AI agents must:

1. Regenerate the JS model if needed.
2. Debug and test the generated JS file directly.
3. Make candidate fixes in the generated JS first.
4. Verify the generated JS behavior there.
5. Only then backport the proven minimal fix to `javascript.jinja` or lower layers.

6. Compile/render one model to JS (`javascript.jinja`).
7. Run only generated JS + `simulateModel.js`.
8. Modify generated JS until behavior is understood/fixed.
9. Backport only minimal/generalizable fixes to templates/compiler.

Use the existing CLI for step 1:

```bash
MODELICA_MSL_ZIP=/path/to/ModelicaStandardLibrary-4.1.0.zip

node packages/shared/modelica/modelica_cli.mjs render-model-js \
  --msl-zip "$MODELICA_MSL_ZIP" \
  --model Modelica.Blocks.Examples.BooleanNetwork1 \
  --use-source-roots \
  --template-file packages/shared/modelica/javascript.jinja \
  --output-file /workspace/.tmp/boolean-network1.generated.js
```

The same CLI now also exposes Rumoca's direct simulation surface for focused smoke checks:

```bash
MODELICA_MSL_ZIP=/path/to/ModelicaStandardLibrary-4.1.0.zip

node packages/shared/modelica/modelica_cli.mjs simulate-model \
  --msl-zip "$MODELICA_MSL_ZIP" \
  --model Modelica.Blocks.Examples.FirstOrder \
  --use-source-roots \
  --t-end 1 \
  --dt 0.02 \
  --solver auto \
  --json
```

This is the preferred way to generate a JS model from a Modelica class + template during debugging.

Node diagnostics do not read MSL from `packages/rumoca/target/msl`. They resolve the same
`modelica_libraries.json` manifest as the browser UI, prefer the configured mirror URL, fall back to
the original upstream URL, and cache the archive under `XDG_CACHE_HOME/taskyon/modelica-libraries` or
`~/.cache/taskyon/modelica-libraries`. Set `MODELICA_DIAG_MSL_ZIP_PATH` only when you need to force a
specific local archive.

The browser UI should treat the MSL ZIP as source material, not as a bundled parsed database. The
first load path builds Taskyon's lightweight class index from the archive, lists classes from that
index, and asks Rumoca to parse only the source-root files needed for the class being inspected,
compiled, or simulated. The `testModelicaTaskyonLazyMslIndexLoadsUnderTwoSeconds` diagnostic guards
that local ZIP expansion plus index build stays under 2 seconds.

Required workflow gate before broader fixes:

- Reproduce the failure in generated JS.
- Validate a candidate fix in generated JS first.
- Compare against cached OMC trace (from `.tmp/modelica-omc-cache` when available).
- Only then backport the minimal fix into template/solver/compiler layers.

If an AI agent edits repo sources before proving the behavior in generated JS first, that work does not follow this runbook and should be treated as incorrect process.

Accepted generated-JS debugging methods include:

- direct instrumentation with temporary logging/assertions in the generated file
- running the generated file directly with `simulateModel.js`
- using the Node debugger or browser debugger on the generated file
- temporary local patches to the generated file to prove the fix before backporting

Forbidden during the initial runtime-debug phase:

- editing `packages/shared/modelica/javascript.jinja` first
- editing `packages/shared/modelica/simulateModel.js` first
- editing Rumoca compiler crates first
- proposing a root-cause fix without showing generated-JS evidence first
- treating diagnostics output alone as sufficient proof for a template or compiler change

Required agent checklist before backporting any runtime fix:

- [ ] I rendered the failing model to a generated JS file.
- [ ] I reproduced the bug in that generated JS file directly.
- [ ] I instrumented or debugged the generated JS file directly.
- [ ] I proved a candidate fix in the generated JS file first.
- [ ] I only backported the smallest change needed after the generated JS fix worked.
- [ ] I documented the generated-JS proof in my notes, PR, or handoff.

Why this is primary:

- It decouples runtime diagnosis from the rest of the compile pipeline.
- It gives a direct place to inspect residuals/events/initialization behavior.
- It avoids guessing whether failure is from template glue vs solver behavior vs DAE partitioning.

## PR Checklist (Required For Runtime/Solver Fixes)

Before merging runtime/solver-related changes, include all items below in the PR description:

- [ ] Failing model and command used to reproduce.
- [ ] Generated JS debug attempt was performed first.
- [ ] Candidate fix was validated in generated JS before backport.
- [ ] OMC trace comparison was run (using cached `.tmp/modelica-omc-cache` trace when available).
- [ ] Backport scope is minimal and generalizable (no model-specific hacks unless explicitly documented).
- [ ] Residual risk and any remaining mismatch to OMC are explicitly listed.

## Template Source Of Truth Policy

For AI-agent development in this repo:

- Treat `packages/shared/modelica/javascript.jinja` as the **single source of truth**.
- Edit only this local template while iterating/debugging.
- Do not edit the duplicate template in `packages/rumoca` during AI-agent iterations.
- Copy/backport stable changes to `packages/rumoca` afterwards as a separate manual step.

Reason: this avoids drift between duplicated templates and reduces token usage during iterative debugging.

## Rumoca Structure (Rough Map)

When debugging compiler behavior, this is the practical high-level flow in `packages/rumoca`:

1. Parse + resolve

- Parsing and name/type resolution happen in phase crates like:
  - `rumoca-phase-resolve`
  - `rumoca-phase-typecheck`

2. Instantiate + inheritance flattening

- Class inheritance/extends handling and instance elaboration happen in:
  - `rumoca-phase-instantiate`

3. DAE lowering and transformations

- Equations/algorithms are lowered into DAE-friendly scalar forms in:
  - `rumoca-phase-dae`

4. Compile/session orchestration

- End-to-end compile APIs and diagnostics wrappers are in:
  - `rumoca-compile`

5. JS rendering/runtime integration (Taskyon side)

- DAE is rendered to JS via:
  - `packages/shared/modelica/javascript.jinja`
- Runtime solve/execution is handled in:
  - `packages/shared/modelica/simulateModel.js`

Use this map for triage: if the issue is semantic correctness, push fix to phases (1)-(3), not only (5).

## Readable JS Generation Goal

Generated JS should prioritize equation readability and low overhead in the hot path.

- Use fast indexed access in solver hot paths (`xVec[i]`, `xDotVec[i]`, `yVec[i]`, `uVec[i]`).
- Avoid mass rebinding/assignment of locals inside residual/evaluation functions.
- Keep equation rows explicit (`const eq_001 = ...`) and return vectors only at API boundaries.
- Add comments above equations and index maps to preserve readability of symbolic intent.

Identifier notation modes:

- `unicode` (default): index marker `ᵢ`  
  Example: `x[1,2] -> xᵢ1ᵢ2`
- `ascii`: index marker `ii`  
  Example: `x[1,2] -> xii1ii2`

Base identifier mapping:

- `.` -> `_`
- `_` -> `__`

Index mode can be selected by setting `dae.__rumoca_js_index_notation` to `"unicode"` or `"ascii"` before template rendering.

## Compare + Baseline Workflow

From repo root:

```bash
set -euo pipefail

# Run compare (auto-target discovery, always writes JSON + text reports)
yarn modelica:compare

# Run the same compare with Rumoca's native WASM simulation surface
yarn modelica:compare:native

# Optional: run against an extra library zip (for example PowerSystems)
node packages/shared/modelica/modelica_compare_cli.mjs run --library-zip /abs/path/PowerSystems.zip

# Optional: select the Rumoca runtime explicitly
node packages/shared/modelica/modelica_compare_cli.mjs run --rumoca-runtime native

# Optional: harden the OMC reference stage for long or huge traces
node packages/shared/modelica/modelica_compare_cli.mjs run \
  --omc-timeout-ms 30000 \
  --omc-max-csv-bytes 268435456

# Diff current run against baseline
yarn modelica:baseline:diff

# Diff current native WASM run against the shared library baseline
yarn modelica:baseline:diff:native

# Accept current run as new baseline
yarn modelica:baseline:update

# Accept current native WASM run into the shared library baseline
yarn modelica:baseline:update:native
```

Notes:

- Source of truth files:
  - Latest run JSON: `packages/shared/modelica/compare/run_latest_<library>.json` (plus global pointer `run_latest_default.json`)
  - Native WASM latest run JSON: `packages/shared/modelica/compare/run_latest_<library>_native.json`
  - Dated run JSON: `packages/shared/modelica/compare/run_<library>_<timestamp>.json`
  - Baseline JSON: `packages/shared/modelica/compare/baseline_<library>.json`
  - Shared runtime profiles inside the baseline use keys such as `js.default`, `native.auto`, `native.rk4`
  - Diff JSON: `packages/shared/modelica/compare/diff_<library>__<profile>.json`
  - Diff CSV: `packages/shared/modelica/compare/diff_<library>__<profile>.csv`
- `run` now auto-discovers targets from loaded library roots (no `--targets-file` required in normal usage).
- JSON run artifact is always written; explicit `--json` flag is no longer required.
- Compare runs enforce independent timeouts for compile, OMC reference generation, and Rumoca
  solver execution. Current defaults are `10000ms`, `30000ms`, and `20000ms`.
- OMC reference CSVs are rejected before parsing when they exceed the configured size cap
  (`--omc-max-csv-bytes`, default `268435456`).
- OMC run directories under `.tmp/modelica-omc-cache/*__run` are now treated as ephemeral.
  After a reference trace is normalized, the harness keeps only the compact per-model JSON cache
  and deletes the raw OMC build / CSV outputs automatically.
- `baseline-update` merges into the library-specific baseline:
  - compile info is shared once per library and refreshed only from `js.*` candidate runs.
  - runtime/solver info is stored per model under the selected runtime profile key.
- `baseline-diff` auto-selects the runtime profile from the candidate run by default and can be overridden with `--baseline-profile <key>`.

## Testing Strategy

This is our testing strategy and should be followed for debugging and triage:

1. Compile and run broad samples first.

- Run the compare workflow against a batch (for example 10 random models) so we exercise compilation and runtime together.
- Do not dilute test scope to improve pass rates. If a target set includes base classes, interfaces, records, or generic models, keep them in scope unless the test objective explicitly defines a narrower set in advance.
- Do not "fix" failures by excluding failing targets post-hoc. Prefer root-cause analysis and real compiler/runtime fixes.

2. If compilation fails, debug at compiler level.

- Inspect Rumoca compiler internals in `packages/rumoca` first.
- If source is invalid per Modelica standard, prefer explicit compiler failure (strict mode) over silent acceptance.
- If a model/library is non-standard and we still need it to run, add an explicit compatibility option/flag, never implicit behavior.
- Rumoca sources are available for direct inspection and modification under `packages/rumoca`; patch there when compiler fixes are required.
- Treat compile failures as compiler/model-front-end problems before touching solver logic.
- For third-party library onboarding, default to strict behavior: keep failing models visible, classify failures into (a) valid model rejected by Rumoca vs (b) invalid/non-standard model correctly rejected, and only suppress categories when explicitly approved and documented.
- If compile time is unexpectedly high (many timeouts or very slow single-model compile), profile Rumoca compiler phases with Rust profiling tooling before raising timeouts blindly. Use a targeted single-model probe first (for example `modelica_compare_cli.mjs probe-compile --model ... --compile-debug`) and then inspect hot paths in Rumoca crates with `cargo` profiling tools.

## Upstream-First AI Workflow Policy

For AI-agent implementation decisions:

1. Push fixes upstream as far as possible

- Prefer root-cause fixes in Rumoca core phases (`resolve`/`typecheck`/`instantiate`/`dae`) before patching template/runtime layers.
- Do not add top-layer workaround code when a lower-layer invariant is broken.

2. Keep compatibility explicit

- Default behavior should stay as strict Modelica as possible.
- Any deviation for library compatibility must be behind an explicit option and documented with:
  - why deviation is required
  - which library/models require it
  - default value (`off` unless explicitly approved otherwise)
- Current practical examples to document when encountered in tests:
  - `PowerSystems` library integration edge cases
  - selected `Modelica Standard Library (MSL)` examples that rely on non-canonical patterns

3. Avoid hidden policy in tests/tooling

- Diagnostics/compare tooling should not silently switch compile strategies.
- If non-standard fallback is used, it must be opt-in and visible in logs/reports.

4. Single source of truth for generated JS logic

- Keep JS generation policy in `packages/shared/modelica/javascript.jinja`.
- Avoid duplicate logic paths for expression rendering/comment rendering; prefer shared macros/data paths.

## Bug Triage Proof Requirements (Mandatory)

For every compiler/runtime bug investigation, include all of the following before proposing a fix:

1. Exact model/library location

- Provide the precise source location in the third-party library or model under test.
- Minimum required detail:
  - library name + version
  - fully-qualified model/class name
  - source file path
  - relevant line(s) or snippet

2. Exact Modelica spec cross-check

- Quote or reference the exact normative wording from the Modelica specification that applies to the case.
- Explicitly map source snippet -> spec requirement, not only error-code interpretation.

3. Explicit verdict

- State one of:
  - `Rumoca bug` (valid Modelica rejected / transformed incorrectly), or
  - `Non-standard library pattern` (strict rejection is correct), or
  - `Ambiguous / requires policy decision`.

4. Fix policy from verdict

- If `Rumoca bug`: fix upstream in Rumoca core phase (resolve/typecheck/instantiate/dae) first.
- If `Non-standard library pattern`: keep strict default, add explicit opt-in compatibility option, and document affected libraries/models.

## Local Rumoca Dev Build (For Modelica Testing)

When testing compiler changes locally, `yarn install` is not enough by itself.
Build the Rumoca npm dev artifact first, then install dependencies:

```bash
set -euo pipefail

cd packages/rumoca/packaging/npm
npm run build:dev
cd /workspace
yarn install
```

Notes:

- `npm run build:dev` produces the local package under `packages/rumoca/pkg/dev-core`.
- For normal usage we install the production Rumoca package from npm.
- For this testing phase we are temporarily pointing to the local `pkg` output directory; this temporary local linkage should be reverted after testing/validation.

3. If solving/runtime fails, isolate via generated JS.

- Compile the failing model into pure JS using the Modelica CLI and the JS template.
- Run only the generated JS and iterate directly on that generated file until the model runs there.
- If runtime limitations are caused by the upstream Rumoca-produced DAE, it is acceptable to patch Rumoca compiler sources directly under `packages/rumoca` and then continue solver debugging.

4. Backport runtime fixes through the template.

- Keep a backup copy of the generated JS before edits.
- Diff edited JS vs backup to identify exactly what changed.
- Backport those minimal, generalizable changes into `packages/shared/modelica/javascript.jinja` first (not as one-off model hacks), then copy to `packages/rumoca` later.

## Run OMC Reference Traces For 10 Random Examples (direct script)

```bash
set -euo pipefail

TARGETS_FILE="packages/rumoca/crates/rumoca-test-msl/tests/msl_tests/msl_simulation_targets_180.json"
RANDOM_10_FILE="/tmp/msl_random_10_targets.json"

node -e 'const fs=require("fs"); const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} fs.writeFileSync(process.argv[2], JSON.stringify(a.slice(0,10), null, 2));' "$TARGETS_FILE" "$RANDOM_10_FILE"

packages/shared/modelica/scripts/generate-omc-traces-via-podman.sh \
  --target-models-file "$RANDOM_10_FILE" \
  --max-models 10 \
  --workers 1 \
  --omc-threads 1
```

## Useful Options

- `--dry-run`: generate `.mos` scripts only
- `--resume`: skip completed batches
- `--batch-timeout-seconds <n>`: timeout per batch/model
- `--stop-time <f64>`: stopTime used for `simulate()`

## Outputs

- OMC reference summary:
  - `packages/rumoca/target/msl/results/omc_simulation_reference.json`
- OMC trace JSON files:
  - `packages/rumoca/target/msl/results/sim_traces/omc`

## Debugging

Set:

```bash
export OMC_PODMAN_DEBUG=1
```

This prints host/container path mapping and OMC argument wiring from the podman wrapper.

## Node Debugger Workflow (Generated JS Runtime)

Use this workflow when a model compiles but fails in solver/runtime and you need step-by-step JS debugging.

1. Compile and render a single model to generated JS using the CLI/template path.
2. Run the generated JS + `packages/shared/modelica/simulateModel.js` in Node.
3. Iterate on the generated JS until the model runs.
4. Backport minimal/general fixes to `packages/shared/modelica/javascript.jinja`.

Recommended render command:

```bash
MODELICA_MSL_ZIP=/path/to/ModelicaStandardLibrary-4.1.0.zip

node packages/shared/modelica/modelica_cli.mjs render-model-js \
  --msl-zip "$MODELICA_MSL_ZIP" \
  --model Modelica.Blocks.Examples.BooleanNetwork1 \
  --use-source-roots \
  --template-file packages/shared/modelica/javascript.jinja \
  --output-file /workspace/.tmp/boolean-network1.generated.js
```

Example debugger entrypoint:

```bash
set -euo pipefail

node --inspect-brk /workspace/.tmp/run_cp_lambda_debug.mjs
```

Suggested `run_cp_lambda_debug.mjs` behavior:

- Load Rumoca wasm.
- Load local debug source roots from:
  - a cached or explicitly downloaded `ModelicaStandardLibrary-4.1.0.zip`
  - an unpacked or cached `WindPowerPlants.zip` archive
- Compile:
  - `WindPowerPlants.Examples.CpLambdaWindTurbine`
- Render with:
  - `packages/shared/modelica/javascript.jinja`
- Evaluate generated `Model()` + `simulateModel(...)`.
- Write artifacts under `/workspace/.tmp/cp_lambda_debug/`:
  - `model.generated.js`
  - `dae_prepared.json`
  - `run_result.json`

Useful debugger breakpoints:

- generated model:
  - `Model()`
  - `residual(...)`
  - `evalAlgebraics(...)`
  - `applyResets(...)`
- solver:
  - `simulate()` and `solveFlowAtState(...)` in `packages/shared/modelica/simulateModel.js`
