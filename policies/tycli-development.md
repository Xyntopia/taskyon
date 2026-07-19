# `tycli` Development Policy

Apply this policy when implementing, debugging, or evaluating `tycli`.

## Evidence From The Real CLI

- Start the real CLI and reproduce the user-facing prompt or command before deciding on a fix.
- Inspect the CLI log and saved conversation transcript for every non-trivial debugging pass.
- Let observed tool calls, task-tree state, provider requests, and runtime failures drive the
  implementation.
- Use the exact provider and model requested for the workflow. Clarify an unavailable identifier
  rather than silently substituting another.

## Autonomous Evaluation

- Once an experiment starts, do not manually complete its implementation, tests, documentation, or
  artifacts and count that as agent success.
- Feed concise independent verification failures back into `tycli` and let it perform corrections.
- Record clarifications, interventions, restarts, logs, traces, changed files, task-tree exports,
  and verification commands.
- A final proof run is autonomous after the initial prompt and any agent-requested clarification.

## Bug And Scope Handling

- Fix blockers on the requested workflow's root-cause path first.
- Treat unrelated discoveries as separate work and ask before pursuing them.
- Ask before making an ambiguous workflow or architecture choice.
- After manual behavior works, add a regression diagnostic through the normal Taskyon processing
  path where possible.
- Keep shared CLI/core changes compatible with browser Taskyon and request browser diagnostic
  verification for shared behavior.
