# Tools and MCP

Tools give Taskyon explicit capabilities such as model calls, code execution, documentation
search, file access, browser research, and application-specific actions.

Open **Tools** to inspect saved tool definitions. Each definition has a name, an LLM-facing
description, a JSON Schema parameter contract, and either sandboxed code or a host-provided
function.

Open **Add MCP Tools** to fetch or paste an MCP `tools/list` response, review the mapped Taskyon
definition, and save selected tools. A saved MCP definition records the remote server information;
it does not make an untrusted server safe.

Tool availability depends on the runtime:

- Browser Taskyon provides browser, UI, storage, and sandbox tools.
- `tycli` provides workspace exploration, patching, downloads, documentation search, and shell
  access inside the environment where it is running.
- Embedded applications can register client tools through `@taskyon/tyclient`.

Developers should use [Tool and Workflow Authoring](../developer/tools-and-workflows.md) for the
current `createTool` and task-chain contracts.
