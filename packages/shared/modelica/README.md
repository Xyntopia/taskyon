# Modelica CLI + OMC Trace Runbook

This package contains the JS Modelica CLI and helper scripts to generate OMC reference traces for MSL examples.

## Prerequisites

- `podman` installed and runnable
- `cargo` available
- Network access for first-time dependency/image/MSL downloads

## Main Script

- Script: `packages/shared/modelica/scripts/generate-omc-traces-via-podman.sh`
- Wrapper used for `omc`: `packages/shared/modelica/scripts/omc-via-podman.sh`

## Run Compare For 10 Random Examples (package.json script)

From repo root:

```bash
set -euo pipefail

yarn modelica:trace-compare:random10
```

Notes:
- `--mode random-stop` now samples from the full target list first, then applies `--max-models`.
- Random mode is deterministic by default (`seed=20260507`).
- Override deterministically with `--seed <n>` when needed.
- This command performs OMC-vs-solver comparison and writes compare reports in the repo root.

## Testing Strategy

This is our testing strategy and should be followed for debugging and triage:

1. Compile and run broad samples first.
- Run the compare workflow against a batch (for example 10 random models) so we exercise compilation and runtime together.

2. If compilation fails, debug at compiler level.
- Inspect Rumoca compiler internals in `packages/rumoca` first.
- Rumoca sources are available for direct inspection and modification under `packages/rumoca`; patch there when compiler fixes are required.
- Treat compile failures as compiler/model-front-end problems before touching solver logic.

3. If solving/runtime fails, isolate via generated JS.
- Compile the failing model into pure JS using the Modelica CLI and the JS template.
- Run only the generated JS and iterate directly on that generated file until the model runs there.

4. Backport runtime fixes through the template.
- Keep a backup copy of the generated JS before edits.
- Diff edited JS vs backup to identify exactly what changed.
- Backport those minimal, generalizable changes into the shared JS template (not as one-off model hacks).

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
