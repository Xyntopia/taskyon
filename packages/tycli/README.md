# `@taskyon/tycli`

Minimal Node-first Taskyon chat CLI.

It currently exposes one tool to the model:

- `bash`: run a command on the host via `bash -lc`

The CLI supports slash commands:

- `/keys`: add/remove provider API keys
- `/model`: change provider/model settings

## Usage

From this directory:

```bash
yarn run
```

From the repository root:

```bash
yarn tycli
```

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
