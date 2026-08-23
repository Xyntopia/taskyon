# tycli

Run the source CLI from the repository root:

```bash
yarn tycli
```

Commands include `/keys`, `/provider`, `/model`, `/tools`, `/debug`, `/settings`, `/client`,
`/resume`, `/search`, `/tree`, `/stop`, `/exit`, and `/quit`. During active work, `/stop` uses the
same cancellation and cleanup path as an interrupt; at an idle prompt it reports that no task is
active.

The CLI registers workspace exploration, patching, download, documentation, and shell-facing
capabilities. Because those tools can modify the host filesystem, run `tycli` inside an appropriate
container, VM, or sandbox.

Configuration defaults to `~/.config/tycli/config.json`. Conversations and logs are recorded for
inspection, and durable task records use the data directory documented in
[Files, Storage, and Secrets](../user/storage-and-security.md).

For a normal debugging run, use one option to enable runtime diagnostics and the redacted
provider requests made by `chatCompletionTool`:

```bash
yarn tycli --debug
```

Conversation snapshots use readable Markdown by default. To save the same task archive as YAML,
use `yarn tycli --conversation-format=yaml`; `/resume` accepts either format.

The runtime `.log` and chat-completion `*_record.json` files are written to the configured tycli
log directory. Detailed task/worker diagnostics are also written to the runtime log, while the
chat remains compact by default. Use `/debug view on` to show detailed task and tool rendering.
`/debug` remains available as an in-session toggle for live diagnostic output, but
it does not retroactively enable request tracing. Remove both artifact types with:

```bash
yarn tycli --clean-logs
```

For an isolated debugging or evaluation run, keep the saved provider and login while overriding
the data and trace directories:

```bash
TYCLI_DATA_DIR=/tmp/taskyon-run/data \
TYCLI_CHAT_COMPLETION_TRACE_DIR=\
/tmp/taskyon-run/trace \
yarn tycli --debug
```

Audit an isolated trace with
`node scripts/audit-tycli-chatcompletion-trace.mjs <trace-dir>`. The records are redacted but may
still contain user or project content, so handle them as debugging artifacts rather than public
logs.

Focused diagnostics:

```bash
yarn tycli:diagnostics:list
yarn tycli:diagnostics --filter documentation --details
yarn tycli:diagnostics --online --provider chatgpt-codex
```

For autonomous coding and research evaluation, follow the controlled experiment protocol and task
catalog in [`tycli` General Agent E2E](tycli-e2e.md).
