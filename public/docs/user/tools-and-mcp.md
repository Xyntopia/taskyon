# Tools, Skills, and MCP

Taskyon treats reusable capabilities as tools. A tool has a name, an LLM-facing description, a
JSON Schema parameter contract, and either sandboxed code or a function supplied by its host. It
may run locally without an AI, combine deterministic operations with selected model decisions, or
orchestrate a fully agentic workflow.

## Tools, skills, and protocols

| Concept      | What it provides                                                                          | Requires an AI                                         | Requires a server                          |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| Skill        | Instructions, references, templates, and optional scripts that teach an agent a workflow  | Usually, because an agent interprets the instructions  | No                                         |
| Taskyon tool | A typed executable capability with explicit inputs, behavior, and results                 | No; the implementation chooses whether to call a model | No                                         |
| MCP          | A protocol for discovering and invoking capabilities across a process or network boundary | No                                                     | Usually an MCP-speaking process or service |

These concepts can work together. An agent can learn a procedure from a skill and turn its stable
steps into a Taskyon tool. Taskyon can import an MCP capability as a tool, and the Taskyon MCP
bridge can expose Taskyon tools to another MCP client. MCP defines how a capability crosses a
boundary; it does not define whether the capability is deterministic, model-driven, cheap, or
safe.

A local tool needs no MCP server or provider request. A tool that calls a remote API still has
network cost and exposes its request to that service. An imported MCP tool has the permissions and
data boundary of its MCP server.

## Model discretion

Tool execution is not limited to an all-or-nothing choice between ordinary code and a fully
autonomous agent. A useful model-discretion spectrum is:

- **0:** algorithms and commands perform the complete workflow;
- **1–3:** deterministic execution handles the normal path, with AI reserved for ambiguity or an
  optional explanation;
- **4–7:** code controls the workflow and evidence, while AI makes selected decisions;
- **8–10:** the model chooses most methods and intermediate steps.

This measures model discretion, not operational autonomy. A deterministic tool can run a complete
workflow autonomously. Prefer the lowest model discretion that preserves correctness. Moving
stable work into code can improve speed, privacy, cost, testing, and replayability.

Record data exposure separately:

- **local:** data remains in the Taskyon runtime;
- **model-visible:** selected data is sent to the configured model provider;
- **external-service-visible:** selected data is sent to an API, MCP server, browser service, or
  another remote capability.

## From conversation to reusable tool

A person and an agent can solve a new problem through research and exploratory tool calls. Once
the useful process is understood, they can move repeatable decisions into a typed tool:

1. identify the inputs, outputs, side effects, and blocking ambiguities;
2. research authoritative formats, APIs, or engineering procedures;
3. implement deterministic parsing, validation, commands, and calculations;
4. keep any model call explicit and limited to a documented semantic decision;
5. verify the tool with representative inputs and visible evidence;
6. reuse the installed tool without repeating the original research or model work.

Taskyon agents can perform this process themselves through the tool-creation capabilities described
in [Agent-Authored Tools](../developer/agent-authored-tools.md). See [Tool Examples](tool-examples.md)
for ideas across research, daily work, software, science, and engineering.

## Tool availability and trust

Open **Tools** to inspect saved definitions. Open **Add MCP Tools** to fetch or paste an MCP
`tools/list` response, review the mapped Taskyon definition, and save selected tools. Saving a
definition does not make untrusted code, data, or a remote server safe.

Availability depends on the runtime:

- Browser Taskyon provides browser, UI, storage, and sandbox capabilities.
- `tycli` provides workspace exploration, patching, downloads, documentation search, and shell
  access inside its environment.
- Embedded applications can register client tools through `@taskyon/tyclient`.

Developers should use [Tool and Workflow Authoring](../developer/tools-and-workflows.md) for the
current `createTool` and task-chain contracts.
