# Testing and Diagnostics

Use focused checks for the boundary being changed.

```bash
yarn test:e2e
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

Playwright writes reports to `playwright-report/` and run artifacts to `test-results/`. Use
`yarn test:e2e:ui` for an interactive runner and `yarn test:e2e:headed` when a visible browser is
enough.

For `tycli`, list and filter diagnostics before running broad sets:

```bash
yarn tycli:diagnostics:list
yarn tycli:diagnostics --filter '<test name>' --details
```

Online diagnostics are opt-in. They reuse the selected CLI provider/model unless the command
explicitly overrides them.

The [`tycli` General Agent E2E](tycli-e2e.md) catalog defines the separate interactive
proof-run protocol, intervention policy, task-tree export, and trace audit used to evaluate
long-running agent behavior.

Documentation changes must run `yarn docs:check`. Source changes should format only edited files.
Run the full `yarn lint` before committing when the broader repository check is required.
