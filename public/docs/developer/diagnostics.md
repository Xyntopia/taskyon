# Testing and Diagnostics

Use focused checks for the boundary being changed.

```bash
yarn test:e2e
yarn test:e2e:production
yarn test:e2e:online
yarn tycli:typecheck
yarn tycli:diagnostics:list
yarn tycli:diagnostics --filter documentation --details
```

The browser diagnostics UI is available at `/diagnostics`. Shared diagnostics must remain runnable
from both browser diagnostics and the Node/`tycli` harness unless an unsupported runtime is
explicitly modeled.

The browser page can filter tests, abort a run, and copy or download its YAML report. Add shared
tests in locations already discovered by the diagnostics runner, such as
`packages/taskyon/src/tests/test*.ts` or common modules exporting named `test*` functions.

Diagnostics that use an LLM must reuse the active browser/CLI profile or explicit harness override.
Do not construct a hidden second provider configuration in the test.

Desktop diagnostics use the `tauri:dev:diagnostics*` scripts. Modelica has separate compare and
baseline commands documented in [Modelica](modelica.md).

Useful desktop paths include:

```bash
yarn tauri:dev:diagnostics
yarn tauri:dev:diagnostics:devserver
yarn tauri:dev:diagnostics:devserver:xvfb
```

The first command builds the diagnostics frontend. The `devserver` variants reuse an existing
Quasar server, and the `xvfb` variants support Linux environments without a desktop session. Add
`:all-logs` only when the default tagged diagnostic output hides information needed for debugging.

To run one browser diagnostic in headless Tauri, start the dev server in one terminal:

```bash
TASKYON_HTTP=1 yarn dev \
  --hostname 127.0.0.1 --port 9000
```

Then run the focused diagnostic in another terminal:

```bash
bash scripts/run-with-xvfb.sh \
  yarn tauri dev \
  -c \
  src-tauri/tauri.diagnostics.devserver.conf.json \
  --no-watch --no-dev-server-wait -- -- \
  --headless --run-diagnostics \
  --test-filter=Greeting \
  --diagnostics-detailed
```

The filter matches test names case-insensitively. The command prints each selected test's result
and a final `HEADLESS_DIAGNOSTICS_RESULT` summary. A model-based test may report `MODEL MISS` while
the process exits normally; inspect the test status as well as the summary. Add
`--diagnostics-allow-long-run` for a test marked `requiresLongRun`, and `--all-logs` when the normal
output is insufficient. Treat `--all-logs` output as sensitive and do not publish it without
review. The browser run uses its active profile, provider session, pinned tools,
standard browser tool registrations, and user-installed JavaScript tools. Its isolated test
conversations do not enter the user's chat history. Native or external user-installed tools cannot
be copied into the isolated runtime automatically; test them through their own host integration.

Headless diagnostics do not wait for the main Taskyon runtime before listing or running tests.
Tests that need a browser profile, key, or Taskyon runtime prepare those dependencies when that
test starts, within its own timeout. A preparation failure is reported as `ERROR` for that test,
not as a model capability miss, and the runner can continue with other tests. A focused browser
run may also select `--diagnostics-model=openai/gpt-5.6-luna` or
`--diagnostics-model=z-ai/glm-5.3-flash` without changing the saved profile.

Playwright writes reports to `playwright-report/` and run artifacts to `test-results/`. The normal
`yarn test:e2e` command starts the local development server. `yarn test:e2e:production` builds the
SPA, serves that local production build, and runs the same suite. Use `yarn test:e2e:ui` for an
interactive runner and `yarn test:e2e:headed` when a visible browser is enough. External-service
tests read `playwright.env.json`. Use `yarn test:e2e:online` when those tests are required: the
command fails instead of skipping them when the credential file is absent or incomplete.

Diagnostics distinguish deterministic checks from model-based capability evaluations. A
model-based evaluation keeps its full assertions, but a miss is reported as `MODEL MISS` and
contributes to the selected model's capability score rather than failing the diagnostics process.
Mark these exported test functions with `testFunction.modelBased = true`; do not use this marker
for deterministic runtime, protocol, storage, or integration failures.

For `tycli`, list and filter diagnostics before running broad sets:

```bash
yarn tycli:diagnostics:list
yarn tycli:diagnostics --filter '<test name>' --details
```

Normal CLI diagnostics output is concise: it prints one `PASS`, `FAIL`, `SKIP`, `MODEL PASS`, or
`MODEL MISS` line per selected test, followed by the summary, every failed deterministic test by
name, and the diagnostics log path. Runtime and test output is appended synchronously to that log
while the run is active, so completed output remains available when a later test or the runner
fails. Logs use `TYCLI_LOG_DIR` when configured and otherwise go to `/tmp/tycli`.

Pass `--verbose` to restore the full live console output, including runtime messages, test start
lines, and the structured summary. `--details` includes failure details and full results without
enabling all live runtime output.

Online diagnostics are opt-in. They reuse the selected CLI provider/model unless the command
explicitly overrides them.

The `ideal-workflows` folder contains five individual workflow diagnostics and one matrix
diagnostic. Each individual diagnostic uses the selected CLI provider and model:

```bash
yarn tycli:diagnostics --online \
  --allow-long-run \
  --filter ideal-workflows \
  --provider chatgpt-codex \
  --model gpt-5.6-luna
yarn tycli:diagnostics --online \
  --allow-long-run \
  --filter ideal-workflows \
  --provider taskyon \
  --model z-ai/glm-5.3-flash
```

Inspect `MODEL PASS` and `MODEL MISS` for each model; the process can exit successfully despite
model misses. Browser diagnostics still use the active browser profile, so this CLI pair complements
rather than replaces a focused browser run.

The sixth test, **Ideal Workflow Matrix With Luna And Glm**, is an ordinary long-running diagnostic
on the `/diagnostics` page. It calls the same five functions with `openai/gpt-5.6-luna` and
`z-ai/glm-5.3-flash`, keeps the saved browser profile unchanged, and reports all ten results
together. Each workflow creates and disposes its own isolated Taskyon test core while the page stays
open. An unexpected task sequence cancels its current workflow immediately; the matrix records that
failure and continues with the remaining pairs.

The same test can run through focused headless Tauri diagnostics without a separate matrix mode:

```bash
yarn tauri dev \
  --no-watch \
  -- --headless \
  --run-diagnostics \
  --diagnostics-allow-long-run \
  --test-filter=\
'Ideal Workflow Matrix With Luna And Glm'
```

A timed-out diagnostic signals its active test to cancel; a provider request already in flight may
still incur a charge.

For request-shape, usage, or prompt-cache debugging, start interactive `yarn tycli --debug`.
This enables live runtime diagnostics and redacted `chatCompletionTool` provider-request records
in the same configured log directory while keeping the terminal chat compact. Detailed task/worker
diagnostics are still written to the runtime log. Use `/debug view on` when detailed task/tool
rendering is needed. Inspect the runtime log, persisted conversation, final tree,
and redacted request records together. Run:

```bash
node \
  scripts/audit-tycli-chatcompletion-trace.mjs \
  <trace-dir>
```

The audit reports ordinary input, cache-read, cache-write, and output tokens when available;
missing provider telemetry must remain unavailable rather than being reported as zero. Before a
release that changes OpenAI request construction or usage accounting, run the bounded live check
with `yarn tycli:diagnostics:release`.

The [`tycli` General Agent E2E](tycli-e2e.md) catalog defines the separate interactive
proof-run protocol, intervention policy, task-tree export, and trace audit used to evaluate
long-running agent behavior.

Documentation changes must run `yarn docs:check`. Source changes should format only edited files.
Run the full `yarn lint` before committing when the broader repository check is required.
