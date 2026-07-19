# `@taskyon/tycli`

Node-first Taskyon CLI for interactive chat and Node diagnostics.

The CLI registers host capabilities alongside Taskyon's shared model and workflow tools:

- workspace exploration and file reads;
- structured file updates;
- verified URL downloads;
- shell commands through `bash -lc`;
- `mapSearchTool` and `overpassMapTool` for OpenStreetMap and Overpass results;
- the active Taskyon documentation corpus;
- interactive clarification requests.

These tools operate in the environment where `tycli` is running. Use a container, VM, or other
sandbox when the model should not have direct access to the host workspace.

The CLI supports slash commands:

- `/keys`, `/provider`, and `/model`: configure model access.
- `/tools`: inspect registered tools.
- `/debug` and `/settings`: change CLI diagnostics and display behavior.
- `/client`: invoke the connected Taskyon client API.
- `/resume` and `/tree`: restore or inspect task history.
- `/exit` and `/quit`: end the session.

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

## HTML previews

Browser Taskyon renders assistant HTML messages in sandboxed message iframes. A terminal cannot
embed that iframe, so `tycli` writes assistant HTML to a temporary preview file and prints a
clickable `file://` URL.

This applies to any HTML assistant message. For example, map tools can return an interactive
MapLibre or PMTiles view that can be opened from terminals supporting clickable links.

## Security

The shell and workspace tools can read and modify files visible to the process. Run the coding agent
in an appropriately scoped sandbox whenever possible. Running it directly on a host can cause
unintended filesystem changes, dependency conflicts, or other effects from model-generated
commands.
