# tycli

Run the source CLI from the repository root:

```bash
yarn tycli
```

Commands include `/keys`, `/provider`, `/model`, `/tools`, `/debug`, `/settings`, `/client`,
`/resume`, `/tree`, `/exit`, and `/quit`.

The CLI registers workspace exploration, patching, download, documentation, and shell-facing
capabilities. Because those tools can modify the host filesystem, run `tycli` inside an appropriate
container, VM, or sandbox.

Configuration defaults to `~/.config/tycli/config.json`. Conversations and logs are recorded for
inspection, and durable task records use the data directory documented in
[Files, Storage, and Secrets](../user/storage-and-security.md).

Focused diagnostics:

```bash
yarn tycli:diagnostics:list
yarn tycli:diagnostics --filter documentation --details
yarn tycli:diagnostics --online --provider chatgpt-codex
```

For autonomous coding and research evaluation, follow the controlled experiment protocol and task
catalog in [`tycli` General Agent E2E](tycli-e2e.md).
