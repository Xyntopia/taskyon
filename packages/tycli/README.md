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

Type `exit` or `quit` to leave the chat.
