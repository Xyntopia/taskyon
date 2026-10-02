# Modelica CLI + OMC Trace Runbook

This package contains the JS Modelica CLI and helper scripts to generate OMC reference traces for MSL examples.

## Retained DAE and Solve compilation

The local simulation-enabled Rumoca WASM build provides
`compile_with_options(source, modelName, optionsJson)`. Request `dae`, `solve`, or both with
`{"representations":["dae","solve"]}`. The default selection is `dae`; empty and unknown
selections are rejected. The returned object retains checked Rust artifacts and owns its WASM
allocation: always call `free()` after rendering or replacing it.

- `representation_json("dae")` returns the original source-analysis DAE, preserving exact JSON
  source identities. It is independent of the prepared source and solver coordinates.
- `representation_json("solve")` returns Rumoca's canonical complete Solve model wire value.
  Constructor-derived artifacts stay in the retained model and Jinja context.
- `render_target(...)` on that object renders the retained representation without recompiling or
  lowering. Solve templates start with `{# rumoca-ir: solve #}` and receive both `solve` and
  `solve_model`; the accompanying DAE metadata is the prepared source used by lowering.
- `solve_error()` reports a Solve preparation refusal without discarding the original DAE.
  Unrequested representations cannot be queried or rendered.

`compileRumocaTemplates` owns compilation, rendering, and disposal for the editor worker and CLI.
Each template has a separate success/error result, so DAE inspection survives a rejected Solve
view. The editor reports the rendering error after retaining DAE metrics and equations.

The installed `@taskyon/rumoca@0.10.3-taskyon.1` uses complete Solve model schema 5 and
problem schema 89. Both JavaScript templates use the compiler's checked variable storage runs
instead of the removed `solver_maps`. The Solve template reads state names through
`solve.state_names()`, decodes the initial Y/P run buffers from exact binary64 bits, and expands
continuous projection declaration runs in their issued order. Initialization projection blocks
retain their separate rows/unknowns contract. Discrete DAE targets carry a variable and an optional
zero-based scalar selection; array resets preserve that selection.

`javascript_solve.jinja` is an independent JS generator that executes checked Solve programs.
Its `{# rumoca-linear-ops: native #}` header declares that it executes supported canonical
`LinearOp` instructions, including typed pure calls and runtime indexing, without requiring
Rumoca to reduce those operations to its simpler scalar-template vocabulary. The rendering
adapter inspects the canonical Solve wire's compute-node tags to select the manifest: models
containing only `ScalarPrograms` use this native program runtime; compact tensor nodes retain
Rumoca's checked scalar fallback. Generic Solve templates keep scalar admission unless they
explicitly declare the native program runtime. Unrecognized model schemas or node tags also
retain scalar admission. Mixed models requiring both compact tensor fallback and operations
that Rumoca cannot safely scalarize remain explicit rendering refusals.
Assignment chains are reconstructed at each trial evaluation; coupled algebraics stay in the
implicit residual. Fully causal algebraic systems with compiler-certified direct assignment
stages can execute their native checked program prefixes even when those programs cannot use
the simpler scalar-template projection. Prefix output stores stay in scratch storage; only the
issued assignment target is committed. The generator retains the compiler's issued order and
uses Newton for other algebraic systems.
Coupled event recovery refreshes eliminated algebraics at each trial discrete coordinate and
after committing the recovered coordinates, so event equations see consistent algebraic values.
It currently supports scalar arithmetic, compact matrix/tensor operations,
conditional regions, runtime array indexing, initialization projection through the caller's Newton
solver, homotopy continuation, scheduled and changing time-event deadlines, and guarded state resets.
Periodic scalar, guarded and structured clock producers execute Rumoca's issued same-tick order, including
checked algebraic intermediate refreshes. Exact rational schedules preserve absolute and
simulation-start origins; clock-owned `previous(...)` history advances only on its clock. Structured discrete maps use
Rumoca's checked scalar target projection at the JS emission boundary, preserving array ordering.
Initialization checks every retained consistency row against the caller's absolute Newton tolerance;
it rejects contradictory constraints instead of ignoring surplus rows. This is not native nominal-scaled
initialization certification. Initialization disables Newton's relaxed small-update early exit so
the solver and retained-row certification use the same absolute tolerance. Checked visible-value programs expose private discrete Integer/Boolean
values without adding Newton unknowns. Event samples retain their own observed values even when
several deadlines fall within one output step. The runtime reaches the requested simulation horizon
with a shortened final step, then executes the separate terminal phase. Reusing a generated model
starts from its retained initial storage and clears action state.
Typed event transactions preserve source-ordered assignments and commit their complete target tuple
once. Transaction-owned assertions use their checked predicate outputs: error assertions prevent
commit, while warnings preserve commit. Ordinary discrete `pre(...)` lanes advance atomically
between whole event passes through the checked event-iteration runs; continuous event-entry history
and clock-owned history retain their separate lifetimes. Condition history stays fixed until the
discrete and algebraic equations have settled together. Event projection and stalled coupled
recovery use the caller’s Newton solver; only checked algebraic and Real-valued equation targets
enter that solve. Boolean, Integer, transaction and clock results stay fixed. Runtime and post-commit
assignment plans propagate derived aliases at trial coordinates and accepted event commits.
Accepted model histories use optional local `checkpointRuntime`, `commitAcceptedStep` and
`maxAcceptedStep` callbacks. Rejected RK45 steps, integrator fallbacks and event-localization trials
restore private model state; accepted internal steps and event left/right limits populate history.
`maxStep` in the standalone solver options limits numerical steps independently of output spacing.
Delay programs use the checked source, delay-time and retention-horizon plans, linear continuous
history and held discrete history. Accepted discontinuities are transported through variable delay
coordinates, including backward crossings and zero-delay transitions. History pruning preserves
interval parity and the left/right limits at equal timestamps. Delay histories reset on a new run.
Algebraic-dependent relations refresh against projected coordinates. Cycles use Rumoca’s checked
root neighborhoods and bounded joint-mode search, restoring rejected candidate coordinates.
Eliminated algebraics refresh after mode changes through the same checked assignment owner.
Model actions preserve initialization edges, latch before condition memory advances, and report
assertions, warnings, termination, and dynamic String messages at accepted coordinates. Typed pure functions preserve Integer values with checked BigInt
arithmetic and exact binary64 constant bits. They support nested calls, finite folds and conditionals,
including early function returns from nested finite `for` loops with checked output definedness,
array views/updates, transpose, checked Integer and Real matrix products and cross products, diagonal/identity construction,
and reductions. Compact scalar folds include nested folds and conditional tensor updates.
Function assertion observations retain failures from each loop iteration, forward nested checks
through the compiler's bindings, and stop on fatal assertions. Message captures are evaluated only
when the check fails; messages read those captured values without executing the function again.
Deterministic random state/result programs preserve all three native generator profiles. Checked
impure random draws use model-local streams and cache each draw by exact time bits and its issued
64-bit call-site identity. Runtime checkpoints restore both stream continuation and cached draws;
failed event passes restore the pre-event stream. Initialization clears streams when a model is reused.
The synthetic checked-program diagnostic compares native draw values and exercises rollback and
instance isolation; it does not establish end-to-end MSL random-model coverage. Table
programs provide bounds, values, slopes, and next events with linear, constant, and Akima
interpolation and native extrapolation modes. `Model(tableData)` accepts an explicit array of
Rumoca `ExternalTableData` records; omitting it uses the retained model's tables. Missing table
data fails explicitly. No table data is downloaded during standalone execution.

The shared diagnostics cover parameter-array overrides, explicit initial equations,
repeated bouncing, coupled algebraic loops, and the original Modelica Orbit invariants. IRK4
projects implicit algebraics at the final state instead of retaining the second internal stage;
fully eliminated systems skip that endpoint projection. Exported
execution uses ordinary JavaScript and the existing standalone JS solvers.
The shared solver keeps compiler-declared held algebraics out of Newton's unknown coordinates
during initialization and SDIRK2, IRK4, and RK45 stages. Initial-guess seeding also preserves them,
so a held `false` Boolean remains false until its owning event assigns it.

Algebraic projection uses Rumoca's checked tearing programs when available: Newton solves the tear
coordinates, and causal assignment programs reconstruct the remaining coordinates in their issued
order. A declined torn solve restores its trial and falls back to the original block. Purely algebraic
models use the same projection callback when inputs change, independently of event activation.
This does not yet remove coupled algebraic coordinates from continuous integration stages.

The optional `evalSolveJacobianVector` callback executes Rumoca's checked directional programs
for derivative RHS and implicit residual rows, including directional pure functions. Its directions
use full solver coordinates plus separate parameter and input arrays. At a consistent primal point,
`evalProjectedJacobianVector` accepts state, parameter and input directions and projects algebraic
tangents through Rumoca's checked blocks before evaluating the derivative RHS. These are local
Jacobians; they do not yet integrate trajectory sensitivities or differentiate event transitions.
Delay models omit these optional directional callbacks until delay-history directions are implemented;
models with emitted impure draws also omit them.
Returning the frozen-history Jacobian as a complete model derivative would be misleading.

This generator is **not yet the default**. Full contract coverage still requires reduced-chart
coordinate selection across manifold folds, trajectory and event sensitivities, and complete
external function/resource bindings. Retained state constraints are reprojected after every
accepted step from Rumoca's checked `manifold_residual` and its solver-Y JVP; a block whose plan
carries alternate charts is still rejected explicitly. `javascript.jinja` retains the existing DAE
generator with its certified-assignment optimization. Neither template relies on computing
Modelica invariants from returned samples.

## Shared DAE and Solve simulation diagnostics

The normal diagnostic registry expands 16 generated-JavaScript simulation cases into separate
`Dae` and `Solve` results. Each pair uses the same Modelica source, simulation settings, and
behavioral assertions. The Modelica-owned collector is shared by the Node CLI, browser diagnostics
page, and headless browser harness; each variant preserves its setup and timeout and runs even if
its sibling fails. Filtering by the original base name selects both variants.

For example, run both bouncing-ball localization variants with:

```sh
yarn diagnostics:modelica:node \
  --filter "Bouncing Ball Event Localization" \
  --details
```

Filtering by ` Dae` or ` Solve` also selects other diagnostics whose names contain that text;
those filter totals are not the simulation-matrix totals. Compiler, DAE inspection, diagram,
library, ABI, and native Rumoca checks retain their own contracts. The FirstOrder generated-JS
check now runs the same source and assertions in both runtimes; its internal Rumoca solver check
has the separate name `Test Modelica Msl First Order Native Simulation` and requires Node.
The handwritten static-model fixture remains a solver-only regression, while a generated
constant-only Modelica case reuses its assertions for both generators.

The duplicate Solve orbit-invariant entry has been replaced by the shared orbit variants.
Solve-specific checks remain for checked programs, derivatives, clocks, transactions, delays,
projection, and other generator capabilities. The MSL resistor consistency check additionally
certifies tear-coordinate projection sizes, and the editor-sample matrix retains all three
integrators, so their distinct assertions are preserved.

The DAE and Solve templates share one native-table runtime
(`packages/modelica/nativeTableRuntime.ts`). It is the JavaScript projection of the certified
`rumoca-eval-solve::table_runtime` evaluator: it keeps descriptor IDs, column selection,
smoothness modes (linear, Akima, constant segments), and extrapolation modes (hold, last two
points, periodic, no extrapolation) bit-compatible, including the holding behavior of both
`NoExtrapolation` and unknown modes. `Test Modelica Native Table Interpolation Regression`
exercises both generators against a pair of MSL `CombiTable1Ds` tables with reordered columns,
Akima interpolation, and periodic constant segments.

The matrix intentionally exposes unsupported behavior as failures. It never substitutes the DAE
output for failed Solve rendering or relaxes behavioral assertions for one generator. Generated-code
checks specific to the DAE template remain DAE checks; the external-symbol resolver assertion is a
separate contract diagnostic. Completing this coverage does not certify complete Solve support.

The storage-mapping regression checks exact floating-point starts, array states, aliases, coupled
algebraics, and outputs through both generators. The discrete-target regression checks independently
owned Boolean array events and the full analytic state trajectory with all three integrators.
The Solve assertion regressions additionally check lazy message evaluation, fatal stop, nested
forwarding, and a warning from an early iteration whose final iteration succeeds.

With `@taskyon/rumoca@0.10.3-taskyon.1`, the full Node run has 105 executed checks passing and
five Worker/DOM-only checks skipped (the CLI summary currently counts skips as passes: 110/110).
All 32 paired simulation variants pass. The final focused `Solve Generator` run passes 51/51.
Typechecking passes. The maintained comparison harness also simulates the MSL resistor example
with both templates: their 28 shared signals differ by at most 3.24e-7 over 0–0.2 seconds. This is
agreement between generators, not an independent reference; OpenModelica/Podman were unavailable.
The Node runs use the real npm WASM package and a verified local MSL archive through a temporary
download transport shim. Browser verification of the updated templates and solver is still pending;
earlier browser results do not verify this migration.

`Test Modelica Prepared Metadata Contract` also passes in both runtimes. Rumoca attaches the
compile provenance to the compile-response envelope, so the diagnostic reads the `version`,
`git_commit`, and `build_time_utc` fields of `__rumoca_build` from the response root and confirms
the canonical native DAE payload stays free of it, matching
Rumoca's `compile_wire_tests` contract. `Test Modelica Solve Generator Manifold Projection` now
passes as well: the Solve template emits Rumoca's retained `manifold_residual` and
`manifold_jacobian_v` programs and reprojects every accepted state onto the checked constraint
through the shared runtime.
These are test outcomes, not numerical parity evidence against an independent simulator.

## Prerequisites

- `podman` installed and runnable
- `cargo` available
- Network access for first-time dependency/image/MSL downloads

## Main Script

- Script: `packages/modelica/scripts/generate-omc-traces-via-podman.sh`
- Wrapper used for `omc`: `packages/modelica/scripts/omc-via-podman.sh`

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

node packages/modelica/modelica_cli.mjs render-model-js \
  --msl-zip "$MODELICA_MSL_ZIP" \
  --model Modelica.Blocks.Examples.BooleanNetwork1 \
  --use-source-roots \
  --template-file packages/modelica/javascript.jinja \
  --output-file /workspace/.tmp/boolean-network1.generated.js
```

The same CLI now also exposes Rumoca's direct simulation surface for focused smoke checks:

```bash
MODELICA_MSL_ZIP=/path/to/ModelicaStandardLibrary-4.1.0.zip

node packages/modelica/modelica_cli.mjs simulate-model \
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
the original upstream URL, and cache the content-addressed archive through Taskyon's StorageClient.
The CLI storage composition chooses the physical data directory; Modelica code does not use a
separate cache path or cache environment variable. Temporary filesystem copies are created only
when an external CLI requires a path and are not durable application storage.

The browser UI should treat the MSL ZIP as source material, not as a bundled parsed database. The
archive, lightweight class index, and rebuildable parsed cache are stored in separate StorageClient
namespaces. The first load path builds the class index from the archive, lists classes from that
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

- editing `packages/modelica/javascript.jinja` first
- editing `packages/modelica/simulateModel.js` first
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

- Treat the selected local generator (`javascript.jinja` or `javascript_solve.jinja`) as its
  source of truth.
- Prove runtime fixes in its generated JS, then edit that local template.
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

- The JavaScript template declares `{# rumoca-ir: solve #}`. The shared renderer requests a
  Solve target from Rumoca's simulation-enabled WASM build; Jinja receives the checked Solve
  plan and its corresponding DAE view.
- For dynamic models without events, inputs or discrete/output coordinates, a complete certified
  algebraic assignment schedule is generated as JavaScript and evaluated at every trial state.
  These algebraics remain in the output but are excluded from Newton's unknown vector. Coupled
  algebraic systems and unsupported execution shapes retain the full residual solve.
- JS is generated via:
  - `packages/modelica/javascript.jinja`
- Runtime solve/execution is handled in:
  - `packages/modelica/simulateModel.js`

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
node packages/modelica/modelica_compare_cli.mjs run --library-zip /abs/path/PowerSystems.zip

# Optional: select the Rumoca runtime explicitly
node packages/modelica/modelica_compare_cli.mjs run --rumoca-runtime native

# Optional: harden the OMC reference stage for long or huge traces
node packages/modelica/modelica_compare_cli.mjs run \
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
  - Latest run JSON: `packages/modelica/compare/run_latest_<library>.json` (plus global pointer `run_latest_default.json`)
  - Native WASM latest run JSON: `packages/modelica/compare/run_latest_<library>_native.json`
  - Dated run JSON: `packages/modelica/compare/run_<library>_<timestamp>.json`
  - Baseline JSON: `packages/modelica/compare/baseline_<library>.json`
  - Shared runtime profiles inside the baseline use keys such as `js.default`, `native.auto`, `native.rk4`
  - Diff JSON: `packages/modelica/compare/diff_<library>__<profile>.json`
  - Diff CSV: `packages/modelica/compare/diff_<library>__<profile>.csv`
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

- Keep JS generation policy in the selected local Jinja generator.
- Keep numerical integration and Newton algorithms in `simulateModel.js`; checked initialization
  callbacks receive its nonlinear solver explicitly.
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

cd packages/rumoca/packages/rumoca-taskyon
npm run build
cd ../../../..
yarn install
```

Notes:

- `npm run build` in the Taskyon packaging directory produces the browser compiler plus Rumoca's native simulation
  surface under `packages/rumoca/packages/rumoca-taskyon/dist/dev-full-web`.
- Use the narrower `build:dev:core` variant only when native simulation is deliberately out of
  scope.
- The workspace pins `rumoca-full-web` to
  `npm:@taskyon/rumoca@0.10.3-taskyon.1`. For compiler development, temporarily change the
  dependency to `file:../rumoca/packages/rumoca-taskyon/dist/dev-full-web` before running
  `yarn install`, then restore the npm dependency when finished.

3. If solving/runtime fails, isolate via generated JS.

- Compile the failing model into pure JS using the Modelica CLI and the JS template.
- Run only the generated JS and iterate directly on that generated file until the model runs there.
- If runtime limitations are caused by the upstream Rumoca-produced DAE, it is acceptable to patch Rumoca compiler sources directly under `packages/rumoca` and then continue solver debugging.

4. Backport runtime fixes through the template.

- Keep a backup copy of the generated JS before edits.
- Diff edited JS vs backup to identify exactly what changed.
- Backport those minimal, generalizable changes into `packages/modelica/javascript.jinja` first (not as one-off model hacks), then copy to `packages/rumoca` later.

## Run OMC Reference Traces For 10 Random Examples (direct script)

```bash
set -euo pipefail

TARGETS_FILE="packages/rumoca/crates/rumoca-test-msl/tests/msl_tests/msl_simulation_targets_180.json"
RANDOM_10_FILE="/tmp/msl_random_10_targets.json"

node -e 'const fs=require("fs"); const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} fs.writeFileSync(process.argv[2], JSON.stringify(a.slice(0,10), null, 2));' "$TARGETS_FILE" "$RANDOM_10_FILE"

packages/modelica/scripts/generate-omc-traces-via-podman.sh \
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
2. Run the generated JS + `packages/modelica/simulateModel.js` in Node.
3. Iterate on the generated JS until the model runs.
4. Backport minimal/general fixes to `packages/modelica/javascript.jinja`.

Recommended render command:

```bash
MODELICA_MSL_ZIP=/path/to/ModelicaStandardLibrary-4.1.0.zip

node packages/modelica/modelica_cli.mjs render-model-js \
  --msl-zip "$MODELICA_MSL_ZIP" \
  --model Modelica.Blocks.Examples.BooleanNetwork1 \
  --use-source-roots \
  --template-file packages/modelica/javascript.jinja \
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
  - `packages/modelica/javascript.jinja`
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
  - `simulate()` and `solveFlowAtState(...)` in `packages/modelica/simulateModel.js`

## Taskyon Rumoca metadata and releases

The Xyntopia `taskyon` branch receives upstream main merges and maintains the
opt-in `taskyon-api` feature. Diagrams read generic metadata from loaded session
documents; unsaved buffers use the same source projector. Taskyon retains archive
indexing and loading on demand. The explicit AST inspector uses a diagnostic-only
raw AST export. Connection annotations are not retained by the upstream AST;
Taskyon continues to route connections dynamically.

Manual release commands and upstream-derived `-taskyon.N` versions are documented
in `packages/rumoca/packages/rumoca-taskyon/README.md`. After the first release,
pin the existing `rumoca-full-web` alias to `npm:@taskyon/rumoca@<exact-version>`.
Until that package is published, the manifest uses the local Taskyon build so
installation never depends on a nonexistent registry version. For local compiler
development, temporarily restore that file dependency and rebuild/reinstall.
