# `@taskyon/tycli`

Node-first Taskyon CLI for interactive chat and Node diagnostics.

It currently exposes one tool to the model:

- `bash`: run a command on the host via `bash -lc`

The CLI supports slash commands:

- `/keys`: add/remove provider API keys
- `/provider`: select a provider and run OAuth login flows
- `/model`: change provider/model settings

## Usage

From this directory:

```bash
yarn run
yarn cli-diagnostics --list
yarn cli-diagnostics --online
yarn cli-diagnostics:modelica
yarn discovery-fixture
```

From the repository root:

```bash
yarn tycli
yarn tycli:diagnostics
yarn tycli:diagnostics:list
yarn tycli:diagnostics:modelica
yarn tycli:discovery-fixture
```

Select provider explicitly:

```bash
TASKYON_SELECTED_API=openrouter.ai OPENROUTER_API_KEY=... yarn run
TASKYON_SELECTED_API=taskyon TASKYON_API_KEY=... yarn run
TASKYON_SELECTED_API=local TASKYON_LOCAL_API_KEY=local yarn run
TASKYON_SELECTED_API=chatgpt-codex yarn run
```

OAuth login helpers:

```bash
yarn run
/provider
```

Optional environment variables:

- `TASKYON_SELECTED_API`
- `TASKYON_MODEL`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `TASKYON_API_KEY`
- `TASKYON_LOCAL_API_KEY`
- `TASKYON_CHATGPT_CODEX_API_KEY`
- `CHATGPT_CODEX_API_KEY`
- `TYAUTH`

Diagnostics defaults:

- `cli-diagnostics` reuses the same persisted `tycli` provider, model, API key, and OAuth login state by default.
- `TYAUTH` / `--tyauth` is only needed for Taskyon auth-token tests such as token minting/proxy coverage.
- `--provider` and `--model` override the stored `tycli` selection for a diagnostics run.

From the Nix dev shell:

```bash
tycli
```

This runs the built bundle from `packages/tycli/bin/tycli.cjs`, so it keeps working even if the current TypeScript sources are temporarily broken. Build it first with:

```bash
yarn tycli:build
```

For direct source-level testing without building:

```bash
tycli-dev
```

Type `exit` or `quit` to leave the chat.

## Security

Because the `bash` tool gives the model full shell access to the host, you should **run the coding agent in a sandboxed environment** (e.g., a container, VM, or Nix sandbox) whenever possible. Running it directly on your host machine carries the risk of unintended filesystem changes, dependency conflicts, or other side effects from model-generated commands.
