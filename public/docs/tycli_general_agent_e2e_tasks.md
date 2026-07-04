# tycli General Agent E2E Task Catalog

These tasks are candidate end-to-end experiments for evaluating whether `tycli` behaves like a
generalized coding and research agent. They must be run through interactive `yarn tycli`, from a
fresh external project workspace, with no login-only services.

The evaluator may inspect files, logs, and command output from outside the CLI, but direct manual
edits by the evaluator do not count as task completion. Final success requires evidence that
`tycli` completed the work itself.

## Experiment Protocol

For every experiment:

1. Create a fresh run directory under `/workspace/tycli-e2e-runs/<task-id>/<run-id>/project`.
2. Prepare the project workspace exactly as the task entry specifies. Each task declares its seed
   mode, seed source, primary language or medium, and expected artifact. Do not decide these
   details during the run based on evaluator preference. If a seed source is unavailable, record
   that as an experiment blocker or update the catalog intentionally before running the task.
   The declared primary language or medium is the baseline for the cataloged experiment. Later
   variants may intentionally use a different language, framework, or medium to broaden coverage,
   but that variation must be recorded up front in the run notes instead of chosen ad hoc during
   execution.
3. When dependencies are installed before a final run, record that as a neutral checkpoint. The
   checkpoint must not contain task-specific implementation work.
4. Start this checkout's CLI with the experiment project as the explicit working directory. Blank
   experiment projects should not inherit unrelated parent workspace instructions from this
   repository; if the trace audit shows parent `AGENTS.md` content in provider instructions, treat
   that as an agent-runtime bug before scoring the project result.

   ```bash
   COREPACK_HOME=/tmp/corepack \
   TYCLI_CWD=/workspace/tycli-e2e-runs/<task-id>/<run-id>/project \
   TYCLI_CHAT_COMPLETION_TRACE_DIR=/workspace/tycli-e2e-runs/<task-id>/<run-id>/llm-trace \
   TYCLI_CHAT_COMPLETION_TRACE_LABEL=<task-id> \
   yarn --cwd /workspace tycli
   ```

5. Give `tycli` one realistic prompt. The prompt should describe the desired outcome and
   acceptance criteria, but it should not tell the agent which tools, files, or shell commands to
   use.
6. Require the final project to include a README or README section written by `tycli` that tells a
   human exactly how to install, run, and manually verify the result. The README must include one
   simple command that can be run from the final project's top-level directory to show the result
   of the task, such as starting the completed web app, launching the CLI/demo, opening a generated
   report, or running the project-specific verification view.
7. Track the project URL/revision, prompt, tycli conversation file, tycli runtime log, trace
   directory, task-tree visualization, interventions, bugs found, restarts, changed files, and
   verification commands.
8. If `tycli` exposes a Taskyon bug, stop the experiment, fix the upstream bug, restart from a
   clean external project when reasonable, and rerun.

Exploratory development may use checkpoints to avoid repeating slow setup. For example, keep a
project copy after dependency installation, after fixture generation, or just before the step that
previously failed, then restart `tycli` from that checkpoint to debug the next issue. Checkpoints
are a development accelerator only; they do not count as final proof unless the final report states
exactly which baseline was reused and why it is acceptable.

## Intervention Policy

- Exploratory runs may include a few corrective prompts. Record every correction and what failure
  mode it addressed.
- Final proof runs must be autonomous: one prompt, no evaluator correction, no interruption, and no
  manual file edits.
- Long-running tasks may reuse downloaded dependencies or a prepared project during exploration.
  The final report must state exactly what was fresh and what was reused.
- For final proof on long-running tasks, a checkpointed starting state is allowed only when it is a
  neutral setup baseline, such as cloned source plus installed dependencies. It must not already
  contain the implementation, bug fix, generated report, or any task-specific progress that `tycli`
  is supposed to perform.
- A task is not complete because the evaluator can fix it. It is complete only when `tycli` drives
  the implementation, verification, and final report.

## Task Tree Visualization

At the end of every run, export the current chat task tree before exiting `tycli`:

```text
/tree
```

Run this from the finished `tycli` session so the file is written into the experiment project's
top-level directory. The tree artifact should be committed or archived with the run directory as
`<project>/taskyon-task-tree.yml`.

`/tree` writes `taskyon-task-tree.yml` by default. A custom path may be passed as an argument when
the hotkey menu is disabled or the command is submitted as a normal line.

The tree export is intentionally structure-only: task ids, roles, task content types, function/tool
names, and branch nesting. It must not include full messages, tool parameters, tool results, or
large LLM outputs. Use it to inspect whether `taskPlanner`, `entryNode`, tool calls, terminal
returns, and re-entry chains are represented in the Taskyon tree as expected.

## LLM Request Tracing

`tycli` can log each chatCompletion request and response into separate files. Set:

- `TYCLI_CHAT_COMPLETION_TRACE_DIR`: directory for trace files.
- `TYCLI_CHAT_COMPLETION_TRACE_LABEL`: optional task label included in file names.
- `TYCLI_CHAT_COMPLETION_TRACE_RAW=1`: optional debug mode that keeps full raw provider stream
  payloads. Leave it unset for normal experiments so output traces store compact summaries and
  token usage instead of duplicating large raw provider dumps.

The chatCompletion tool also has a `trace` parameter with `enabled` and optional `label` fields.
When entryNode tracing is enabled, every LLM request gets paired files like:

- `0001_task-08_<task-id>_input.json`
- `0001_task-08_<task-id>_output.json`

The trace directory can be counted later to approximate per-task character volume and compare task
costs.

## Post-Experiment Trace Audit

After every finished experiment, audit the trace directory before calling the run complete:

- Run `node scripts/audit-tycli-chatcompletion-trace.mjs <trace-dir>` and include the totals,
  cache-prefix warnings, and any follow-up fixes in the experiment report.
- Count chatCompletion calls by paired `*_input.json` and `*_output.json` files.
- Report total input characters, output characters, file bytes, and provider token usage when the
  trace includes it.
- Report cached input tokens when the provider exposes them. If cached tokens are zero or missing,
  inspect whether the first messages are stable enough for prompt caching.
- Check whether the first one or two messages are identical across requests. Stable leading
  messages improve provider-side prompt-cache reuse.
- Check the common task-tree message prefix between consecutive requests. Early task nodes should
  remain byte-stable as the task tree grows, and cache reads should generally appear once the
  common prefix is large enough.
- For `chatgpt-codex`, also check that `providerOptions.openai.instructions` is stable across
  requests. The provider instruction prefix must not include timestamps, recent tool-result text,
  loaded file context, or unrelated parent workspace instructions.
- For `chatgpt-codex`, also check that the request `promptCacheKey` stays stable across calls in
  the same user task. The key should be derived from stable task identity, not from timestamps,
  tool results, or changing runtime context.
- Do not send provider cache-retention override fields to the ChatGPT Codex backend unless a live
  compatibility check proves the endpoint accepts them. In the observed July 2026 run,
  `prompt_cache_retention` was rejected even though prompt caching itself and `promptCacheKey`
  were supported.
- Treat `prependSystemPrompts` as the stable provider-instruction prefix. Use
  `appendSystemPrompts` for volatile context such as ISO/local time, recent tool results, current
  editor state, loaded file context, or retry guidance, so those details appear after the
  accumulated chat instead of invalidating the cache prefix.
- In tycli, include ISO/local time only as a short appended runtime reference. Do not append last
  task results or similar task-tree facts there; chatCompletion already flattens the task tree into
  the LLM chat, so duplicating that context wastes tokens and shortens useful cache-prefix reuse.
- Keep late appended volatile prompts as short and non-distracting as possible. Label them as
  low-priority runtime/reference context, and avoid restating persona, tool policy, or task
  instructions after the user's latest request.
- Avoid injecting a different transient late prompt on every agent loop when the same workflow will
  continue through multiple chatCompletion calls. Even if the earlier task-tree messages are
  byte-stable, a changing unpersisted tail can reduce the exact-prefix span that can be reused by
  later requests. Prefer persisted task nodes, stable prepend prompts, tool results already present
  in the task tree, or no extra runtime prompt.
- For tycli-style agent loops, prefer stable routine continuation rules in the provider
  instruction prefix over appending a routine "continue/analyze previous tool result" system prompt
  on every turn. The task tree already contains the prior user/tool messages; repeating transient
  control prompts at the tail reduces cacheability.
- Inspect repeated prompt sections and oversized trace payloads. Call out duplicated project
  instructions, repeated tool catalogs, raw response dumps, repeated file contents, or long
  reasoning/output records.
- Record concrete follow-up fixes when the trace shows avoidable waste, such as moving stable
  system context earlier, trimming unrelated parent `AGENTS.md` content, or storing large raw
  provider payloads separately from the lightweight output summary.
- For research and documentation tasks, keep a source budget. Prefer extracted notes, citations,
  manifests, and small normalized artifacts over archiving raw HTML or full documentation pages
  unless the task explicitly asks for raw source files.
- Before accepting an experiment, run the README's one-command human check from the project root.
  If the command fails, the run is not complete even if files were generated.
- Check the final task tree and CLI status. The worker should settle cleanly after the final
  return, and queued or waiting tasks after the final report should be treated as a runtime issue.
- End every experiment report with a **Human Check** section. It should give the exact top-level
  project command a human should run to show the result, plus any local URLs or files needed to
  inspect whether the project task was successful and the specific behavior to try manually.

## Selection Criteria

- No account login, private API key, or paid service is required beyond the configured LLM
  provider used by `tycli`.
- The task has observable output: changed files, passing commands, generated artifacts, or sourced
  reports.
- The task exercises a distinct agent capability.
- Final success can be judged from the external project diff, tycli logs, trace files, and local
  verification output.

## Agent Inspiration and Taskyon Fit

It is useful to compare these runs against opencode and other agent projects for prompt shape,
ergonomics, transcript quality, recovery behavior, and benchmark design. Those projects should be
used as inspiration, not as the architecture source of truth.

Taskyon experiments should still validate the Taskyon way of working: explicit tools, visible task
trees, replayable task state, entry-node reentry, and traceable chatCompletion requests. If another
agent has a useful behavior, translate it into Taskyon's task-tree and tool model instead of
copying hidden loop state or one-off orchestration.

## Tasks

### 1. Add a CLI Smoke-Test Section

**Complexity:** Short.

**Seed mode:** Existing small public project.

**Seed source:** Clone `https://github.com/sindresorhus/pretty-bytes`.

**Primary language or medium:** JavaScript and Markdown.

**Expected artifact:** README section.

**Realistic prompt:** "This CLI/package project is missing a quick smoke-test section for new
contributors. Please inspect how it is run, add a concise README section with the fastest local
startup/check command, and verify the docs formatting or package check if one exists."

**Expected capabilities:** project onboarding, script discovery, docs editing, scoped
verification.

**Final autonomous acceptance checks:**

- The README uses real scripts from the project.
- `tycli` runs at least one relevant local verification command.
- The final report names the changed file and verification result.

### 2. Create a Blank Python Report Generator

**Complexity:** Short.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** Python.

**Expected artifact:** Python CLI plus generated markdown report.

**Realistic prompt:** "Please create a tiny local Python project that reads a CSV file, computes
row count, missing values, and numeric column averages, writes a markdown report, and includes a
sample CSV plus one command to regenerate the report."

**Expected capabilities:** project scaffolding, Python scripting, file IO, documentation.

**Final autonomous acceptance checks:**

- The project includes a sample CSV and generated markdown report.
- One top-level command regenerates the report.
- Missing values are handled explicitly.

### 3. Add a Focused Example to a Go CLI Library

**Complexity:** Medium.

**Seed mode:** Existing small public project.

**Seed source:** Clone `https://github.com/spf13/cobra`.

**Primary language or medium:** Go.

**Expected artifact:** Example command or documentation test.

**Realistic prompt:** "Please add a focused example that shows how to create a command with a
required flag and useful validation. Keep it consistent with this project's existing examples and
run the smallest Go test or documentation check that proves it works."

**Expected capabilities:** Go project onboarding, example-driven documentation, targeted testing.

**Final autonomous acceptance checks:**

- The example follows the project's existing style.
- Flag validation is demonstrated.
- A targeted Go check passes.

### 4. Diagnose a Rust CLI Startup Path

**Complexity:** Medium.

**Seed mode:** Existing small public project.

**Seed source:** Clone `https://github.com/BurntSushi/ripgrep`, sparse-checkout or shallow clone is
allowed because this is a larger repository.

**Primary language or medium:** Rust.

**Expected artifact:** Startup/build note or smallest fix.

**Realistic prompt:** "Please try to run the project the way its README suggests for a local
developer. If it fails, diagnose the root cause and fix the smallest issue. If it already works,
document the exact startup or smoke-test path for future contributors."

**Expected capabilities:** command execution, Rust tooling, error triage, evidence reporting.

**Final autonomous acceptance checks:**

- The first observed command result is recorded.
- Either the startup works after a fix or the blocker is concrete and reproducible.
- The final report distinguishes evidence from guesses.

### 5. Improve a Ruby Build Script Workflow

**Complexity:** Medium.

**Seed mode:** Existing small public project.

**Seed source:** Clone `https://github.com/ruby/rake`.

**Primary language or medium:** Ruby.

**Expected artifact:** Small Rake task or documentation improvement with a focused check.

**Realistic prompt:** "Please inspect how this Ruby project organizes its Rake tasks and add a
small contributor-facing task or documentation improvement that makes a common local check easier
to discover. Keep it idiomatic and run the most focused verification command."

**Expected capabilities:** Ruby project onboarding, build-task discovery, documentation, targeted
verification.

**Final autonomous acceptance checks:**

- The task or documentation points at a real local workflow.
- The implementation follows the project's existing patterns.
- A focused Ruby check or task listing passes.

### 6. Patch a Python Edge Case

**Complexity:** Medium.

**Seed mode:** Existing small public project.

**Seed source:** Clone `https://github.com/pallets/click`.

**Primary language or medium:** Python.

**Expected artifact:** Regression test plus production fix.

**Realistic prompt:** "Please find a simple edge case in this package, capture it with a regression
test, fix the library code, and run the relevant pytest target."

**Expected capabilities:** Python onboarding, test-first workflow, bug fixing.

**Final autonomous acceptance checks:**

- A regression test is added.
- The fix is in production code, not just the test.
- The targeted pytest command passes.

### 7. Build a Blank Rust Text Tool

**Complexity:** Medium.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** Rust.

**Expected artifact:** Rust CLI crate.

**Realistic prompt:** "Please create a small Rust CLI that reads a text file and prints line count,
word count, and the five most common words as JSON. Include a sample input, a minimal test, and one
top-level command to run the demo."

**Expected capabilities:** Rust project scaffolding, CLI parsing, tests, JSON output.

**Final autonomous acceptance checks:**

- `cargo test` or a documented focused equivalent passes.
- The demo command prints deterministic JSON.
- The README includes the exact top-level demo command.

### 8. Build a Static Operations Dashboard

**Complexity:** Medium.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** HTML, CSS, and vanilla JavaScript.

**Expected artifact:** Local static web app.

**Realistic prompt:** "Please build a local operations dashboard with accounts, usage trend,
alerts, and a filter using plain browser files. Keep it lightweight, make the dashboard the first
screen, and verify it runs locally."

**Expected capabilities:** frontend implementation, UX judgment, responsive layout, build
verification.

**Final autonomous acceptance checks:**

- The dashboard is the first screen, not a marketing page.
- Filtering changes visible data.
- A local build or dev smoke check passes.

### 9. Build a Shell-Based CSV Audit Tool

**Complexity:** Medium.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** POSIX shell, awk, and Markdown.

**Expected artifact:** Shell script plus generated audit report.

**Realistic prompt:** "Please create a small portable command-line tool that audits a CSV file for
missing fields, duplicate IDs, and basic numeric ranges using shell and awk. Include sample data,
a generated markdown report, and one top-level command to rerun the audit."

**Expected capabilities:** shell scripting, text processing, portability, artifact generation.

**Final autonomous acceptance checks:**

- Invalid rows are reported without crashing.
- The generated report is deterministic.
- `tycli` verifies the top-level audit command.

### 10. Create a Pixel-Art Asset Pack

**Complexity:** Medium.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** SVG, PNG export if available, HTML, and Markdown.

**Expected artifact:** Local visual asset pack and preview page.

**Realistic prompt:** "Please create a small local pixel-art style asset pack for a fictional
space-mining game: ship, asteroid, ore, and warning icon. Include a preview page, usage notes, and
one top-level command that verifies or opens the preview."

**Expected capabilities:** visual artifact creation, asset organization, local preview, basic
render verification.

**Final autonomous acceptance checks:**

- The preview shows all assets without external dependencies.
- The assets are reusable files, not only inline prose.
- The final report explains how the visual output was checked.

### 11. Analyze a Public Dataset with R

**Complexity:** Medium.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** R and Markdown.

**Expected artifact:** Reproducible R script plus markdown report.

**Realistic prompt:** "Please add a reproducible analysis that downloads the Palmer Penguins CSV
from `https://raw.githubusercontent.com/mwaskom/seaborn-data/master/penguins.csv`, computes three
useful summary statistics with R, and writes a markdown report."

**Expected capabilities:** data acquisition, R scripting, malformed-row handling, report
generation.

**Final autonomous acceptance checks:**

- The data source URL is recorded.
- One command regenerates the report.
- Missing or malformed rows are handled explicitly.

### 12. Research WebGPU Support and Write a Memo

**Complexity:** Medium.

**Seed mode:** Blank research workspace.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** Markdown research writing.

**Expected artifact:** Sourced decision memo.

**Realistic prompt:** "Please research the current state of WebGPU browser support and write a
sourced decision memo for a team choosing between WebGL and WebGPU."

**Expected capabilities:** web research, source comparison, citations, tradeoff analysis.

**Final autonomous acceptance checks:**

- The memo cites current high-quality sources.
- Confirmed facts are separated from uncertainty.
- The recommendation states assumptions that would change it.

### 13. Compare Local Analytics Storage Options

**Complexity:** Medium.

**Seed mode:** Blank research workspace.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** Markdown research writing.

**Expected artifact:** Technical decision memo.

**Realistic prompt:** "Please write a decision memo comparing SQLite, DuckDB, and plain Parquet
files for a local-first analytics feature that must work offline and handle medium-sized CSV
imports."

**Expected capabilities:** technical research, official-doc citation, decision writing.

**Final autonomous acceptance checks:**

- Official or primary docs are cited for all compared options.
- The memo recommends one path for the stated project shape.
- Risks, migration costs, and data-size assumptions are concrete.

### 14. Build a Public API Client and Report in Go

**Complexity:** Medium.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** Go.

**Expected artifact:** Local API CLI plus JSON and markdown output.

**Realistic prompt:** "Please build a small CLI command that calls the no-auth Open-Meteo forecast
API for Berlin, normalizes the current weather response, and writes both JSON and markdown output.
Use Go for the baseline implementation."

**Expected capabilities:** HTTP calls, schema normalization, error handling, artifact writing.

**Final autonomous acceptance checks:**

- Non-200 responses are handled.
- Output files are deterministic enough to diff.
- The README or final report includes the rerun command.

### 15. Add a Markdown Search Indexer to Taskyon

**Complexity:** Long-running.

**Seed mode:** Existing large public project.

**Seed source:** Clone `https://github.com/xyntopia/taskyon`.

**Primary language or medium:** TypeScript.

**Expected artifact:** Local search-index generation workflow.

**Realistic prompt:** "Please add a local search-index generation workflow for this docs project.
The index should include title, path, headings, and excerpts, and there should be a clear command
to regenerate it."

**Expected capabilities:** large-repo navigation, filesystem traversal, markdown parsing,
generated artifact policy, documentation.

**Final autonomous acceptance checks:**

- Generated output has stable ordering.
- Build/generated directories are ignored.
- The project documents whether the index should be committed.

### 16. Create a Technical Presentation Deck

**Complexity:** Medium.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** Typst or Markdown slides, plus exported HTML/PDF if local tools
allow it.

**Expected artifact:** Local presentation deck.

**Realistic prompt:** "Please create a short local presentation deck explaining how an agentic CLI
should handle planning, tool use, verification, and trace auditing. Include speaker notes, a simple
theme, and one command to view, export, or validate the deck."

**Expected capabilities:** synthesis, presentation structure, visual layout, local preview command.

**Final autonomous acceptance checks:**

- The deck has at least six slides and speaker notes.
- The first slide states the topic clearly.
- A top-level command opens, serves, or exports the deck.

### 17. Package a Tiny Local Markdown CLI

**Complexity:** Medium.

**Seed mode:** Existing small public project.

**Seed source:** Clone `https://github.com/TimMikeladze/typescript-react-package-starter`.

**Primary language or medium:** TypeScript.

**Expected artifact:** Local markdown-stat CLI.

**Realistic prompt:** "Please turn this package into a small CLI that accepts a markdown file,
counts words and headings, prints JSON, includes a minimal test, and documents one robust
top-level command that works from the project root."

**Expected capabilities:** package setup, TypeScript CLI design, tests, local execution.

**Final autonomous acceptance checks:**

- The CLI exits non-zero for a missing file.
- The test command passes.
- The documented top-level command does not rely on fragile TSX IPC behavior.

### 18. Add a Frontend Feature to a Popular App

**Complexity:** Long-running.

**Seed mode:** Existing large public project.

**Seed source:** Clone `https://github.com/todomvc/todomvc`.

**Primary language or medium:** JavaScript and CSS.

**Expected artifact:** User-facing frontend feature.

**Realistic prompt:** "Please add a real user-facing feature to this app that fits its existing
style. Inspect the project first, choose the smallest coherent implementation, update tests or docs
if appropriate, and prove the app still builds or runs."

**Expected capabilities:** product judgment, frontend architecture, scoped implementation,
verification.

**Final autonomous acceptance checks:**

- The feature is visible and usable.
- The implementation follows local patterns.
- The project build or test suite passes.

### 19. Create a Security-Oriented Dependency Note

**Complexity:** Medium.

**Seed mode:** Existing small public project.

**Seed source:** Clone `https://github.com/psf/requests`.

**Primary language or medium:** Python and Markdown.

**Expected artifact:** Security note.

**Realistic prompt:** "Please inspect this project's dependencies and write a short security note
covering supply-chain risk, update posture, and safe local execution. Use only public no-login
sources and local commands."

**Expected capabilities:** dependency reading, risk assessment, careful claims.

**Final autonomous acceptance checks:**

- Known evidence is separated from hypotheses.
- The note includes local commands maintainers can run.
- It does not claim a vulnerability without proof.

### 20. Produce a Local Architecture Infographic

**Complexity:** Long-running.

**Seed mode:** Blank project.

**Seed source:** Empty directory, no cloned repository.

**Primary language or medium:** SVG, HTML, CSS, and Markdown.

**Expected artifact:** Static infographic plus explanatory report.

**Realistic prompt:** "Please research common architecture patterns for local-first agent tools
and create a static infographic plus a short sourced report. The infographic should be viewable
locally without external assets and the report should cite the sources used."

**Expected capabilities:** research, synthesis, visual artifact generation, local preview,
documentation.

**Final autonomous acceptance checks:**

- The infographic is a real visual file, not only prose.
- The report cites public no-login sources.
- One top-level command opens, renders, or verifies the visual artifact.

## Coverage Matrix

| Area                                 | Representative tasks |
| ------------------------------------ | -------------------- |
| Blank-project scaffolding            | 2, 7, 8, 9, 10, 11   |
| Existing small-project modification  | 1, 3, 5, 6, 17, 19   |
| Existing large/popular project work  | 4, 15, 18            |
| CLI/project onboarding               | 1, 4, 5, 7, 14, 17   |
| Third-party code editing             | 3, 5, 6, 15, 18      |
| Local app, webpage, or visual build  | 8, 10, 16, 20        |
| Research, writing, and presentations | 12, 13, 16, 19, 20   |
| Data, shell, and public APIs         | 2, 9, 11, 14         |
| Non-code visual artifacts            | 10, 16, 20           |
| Long-running workflows               | 15, 18, 20           |

## Suggested Scoring Rubric

- **Autonomy:** The final proof run completes from one realistic prompt with no intervention.
- **Completion:** The requested artifact exists and matches the prompt.
- **Evidence:** The agent reports real commands, checks, changed files, and source links where
  relevant.
- **Scope control:** The agent avoids unrelated edits and broad rewrites.
- **Root cause:** Debugging tasks explain upstream causes instead of patching symptoms.
- **Traceability:** The tycli transcript, runtime log, and chatCompletion trace files can be tied
  back to the task id.
