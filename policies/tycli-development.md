# `tycli` Development Policy

Apply this policy when implementing, debugging, or evaluating `tycli`.

## Evidence From The Real CLI

- Start the real CLI and reproduce the user-facing prompt or command before deciding on a fix.
- Inspect the CLI log and saved conversation transcript for every non-trivial debugging pass.
- Let observed tool calls, task-tree state, provider requests, and runtime failures drive the
  implementation.
- Use the exact provider and model requested for the workflow. Clarify an unavailable identifier
  rather than silently substituting another.
- Full diagnostics include online provider-backed tests such as entry-node web search. They require
  network access and valid provider credentials. In a restricted sandbox, failures such as
  `EAI_AGAIN api.openai.com` can indicate unavailable networking rather than a regression; rerun
  them with network access before treating them as product failures.

## Session And Provider Discipline

- Start interactive work with the normal `yarn tycli` entrypoint and reuse its persisted OAuth
  login, provider, and model selection. Do not configure keys, change providers or models, import
  credentials, or silently substitute a model unless the user requests it.
- Add only task-scoped environment such as `TYCLI_CWD`, `TYCLI_CHAT_COMPLETION_TRACE_DIR`, and a
  stable `TYCLI_CHAT_COMPLETION_TRACE_LABEL`. Confirm the startup banner shows the expected
  provider and model before submitting the task prompt.
- If sandbox restrictions hide persisted state or block required network access, rerun with the
  needed permissions instead of creating a temporary profile or copying credentials.

## Debugging Evidence Bundle

- Enable per-chatCompletion tracing before the first prompt and enable live session debug logging
  through `/debug` for every non-trivial debugging or evaluation run.
- Record and inspect the runtime log, persisted Markdown conversation, redacted chatCompletion
  records, final task-tree export, changed files, and verification command output.
- Run `scripts/audit-tycli-chatcompletion-trace.mjs` after the run. Report call counts, request and
  file sizes, normal input tokens, cache-read tokens, cache-write tokens, output tokens,
  stable-prefix findings, and warnings. Treat absent provider usage as unavailable, never as zero.
- Evaluate prefix stability within a request family: provider, model, task-tree root cache key,
  and tool declaration shape. Check stable instructions within that family rather than using their
  hash to create a new family. Router and executor requests share the task-tree root cache key but
  remain distinct audit families when their tool declarations differ.
- Keep the provider cache key stable for the whole task-tree root, including parallel branches.
  Measure the common wire prefix when sibling branches diverge; do not create per-branch provider
  cache keys or assume that requests with a shared key overwrite sibling prefixes.
- For ChatGPT Codex trace stability, exclude trailing runtime `developer` messages from the
  conversation-prefix comparison. Audit those volatile suffixes separately; they are not the
  stable first or second conversation message as the task-tree history grows.
- Use `/settings` to reveal full function results only when truncation blocks diagnosis; the
  additional output may be large or sensitive. Use `/tools` to inspect registered capabilities,
  `/client` to probe the connected client boundary, `/resume` or `/search` to inspect persisted
  history, and `/stop` for genuinely stuck or unsafe work.
- Use diagnostic list and filter modes plus `--verbose`, `--details`, or `--json` when they improve
  product diagnosis, but do not substitute them for reproducing the behavior in the real
  interactive CLI.
- Never expose raw credentials or unredacted secrets in terminal output, logs, traces, or reports.
- Confirm the worker settles with no queued or waiting tasks before calling a run complete.
- The CLI `bash` tool must use a non-login shell so user login profiles cannot silently replace the
  inherited runtime environment. Preserve the inherited environment and working directory.

## Autonomous Evaluation

- Give each cataloged E2E run its own `TYCLI_DATA_DIR` beneath the run directory. This isolates all
  Taskyon `StorageClient` records and blobs, including generated tools, tasks, artifacts, and
  transcripts, while reusing the normal saved tycli provider, model, OAuth, and encrypted
  configuration.
- For a final proof run, the evaluator may prepare only the catalog's declared neutral seed, enable
  logging and tracing, submit the catalog prompt once, answer agent-initiated structured
  clarification, and export the final task tree. The evaluator must not supply planning hints,
  implementation commands, corrective prompts, manual project edits, or task-specific artifacts.
- Once an experiment starts, do not manually complete its implementation, tests, documentation, or
  artifacts and count that as agent success.
- An evaluation request does not by itself authorize adding a diagnostic or test. Run the
  cataloged task through `tycli`; let `tycli` create its artifacts and use external inspection only
  to verify them.
- Feed concise independent verification failures back into `tycli` and let it perform corrections.
- Record clarifications, interventions, restarts, logs, traces, changed files, task-tree exports,
  and verification commands.
- Treat missing runtimes and similar prerequisites as neutral setup. Record dependency changes and
  checkpoints, continue investigating recoverable failures, and distinguish an intervened
  exploratory run from an autonomous final proof run.
- When an evaluation needs a task-specific runtime that is absent from the AI sandbox, install it
  inside the Ubuntu sandbox with `apt` or `apt-get` and record that setup. Do not add evaluation-only
  runtimes to `flake.nix`, package manifests, or the repository's normal development environment;
  change those files only when the product or its standard development workflow requires the
  dependency.
- A final proof run is autonomous after the initial prompt and any agent-requested clarification.

## Post-Debug Coverage

- After the run succeeds and its discovered errors are resolved, summarize the failure modes and
  offer to add focused CLI regression diagnostics for the Taskyon defects that caused them. Do not
  add those tests without the user's approval.
- Separately offer a whole-workflow CLI E2E scenario when it would protect meaningful integration
  behavior. State its expected provider, network, token, runtime, and duration costs so the user
  can choose between focused deterministic coverage, model-based E2E coverage, or both.
- Keep catalog artifact acceptance separate from product regression coverage. A generated project
  test belongs to the evaluated project; a Taskyon regression belongs at the owning Taskyon or
  `tycli` boundary and must reproduce the upstream defect rather than the incidental task output.
- Before a release that changes OpenAI request construction or usage accounting, run
  `yarn tycli:diagnostics:release`. It reuses the saved tycli login, uses `gpt-5.6-luna`, keeps a
  strict request/output budget, and runs shallow, medium, and deep branches twice under one stable
  task-tree cache key. Report normal-input, cache-read, and cache-write tokens for every branch and
  pass, with cold-pass and repeated-pass cache percentages kept separate. Verify that repeated
  branch request bodies remain byte-stable. A missing cache hit is a model/provider capability
  miss; missing required telemetry or request drift is a product regression.

## Bug And Scope Handling

- Fix blockers on the requested workflow's root-cause path first.
- Treat unrelated discoveries as separate work and ask before pursuing them.
- Ask before making an ambiguous workflow or architecture choice.
- Keep shared CLI/core changes compatible with browser Taskyon and request browser diagnostic
  verification for shared behavior.
