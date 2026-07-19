# `@taskyon/taskyon`

Taskyon's task engine, protocols, tool contracts, model orchestration, and shared runtime logic.

Use explicit package entry points:

- `@taskyon/taskyon/api` for client, protocol, task, storage, and tool contracts;
- `@taskyon/taskyon/browser` for browser authentication helpers;
- `@taskyon/taskyon/tools` and `@taskyon/taskyon/tools/<module>` for tool definitions;
- `@taskyon/taskyon/db` for the configured database boundary.

The broad root entry point also exposes internal implementation utilities and is not the preferred
integration surface.

Shared code must remain compatible with browser Taskyon and Node/`tycli`. Host-only capabilities
belong at the runtime registration boundary.

Tests under `src/tests/test*.ts` are discovered by the browser and CLI diagnostics suites.
