# Tool and Workflow Authoring

Keep a tool's name, description, parameter schema, render options, and function together.

```ts
import { createTool, toolCall } from '@taskyon/taskyon/api'

export const summarize = createTool({
  name: 'summarize',
  description: 'Summarize the supplied text.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  } as const,
  async function({ text }, context) {
    const chain = await context.getExecutionTaskChain()
    if (context.stopSignal.aborted) throw new Error('Cancelled')
    return context.createSubtasksResult([
      [
        { role: 'assistant', content: { type: 'message', data: `${text} (${chain.length})` } },
        { role: 'system', content: { type: 'return', data: 'complete' } },
      ],
    ])
  },
})
```

Return a plain value when the entry node should interpret it. Return
`context.createSubtasksResult(...)` when order, branching, or completion must be explicit.

Use one array for a sequential chain and multiple inner arrays for parallel chains. Iterative work
should return reducer or continuation tasks instead of running a hidden loop inside one tool.

Use `toolCall({ name, arguments })` to add a tool invocation to a task chain. Keep state in visible
task nodes, explicit arguments, or persisted artifacts.

## Choose the lowest necessary model discretion

A tool is an executable capability, not necessarily an AI call. Put known parsing, validation,
calculation, and transformation rules directly in code:

```ts
export const textStatistics = createTool({
  name: 'textStatistics',
  description: 'Count words and non-whitespace characters in text.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  } as const,
  function: ({ text }) => ({
    words: text.trim() ? text.trim().split(/\s+/u).length : 0,
    nonWhitespaceCharacters: text.replace(/\s/gu, '').length,
  }),
})
```

When semantic judgment is genuinely required, make the model call an explicit step rather than
hiding it in otherwise deterministic code:

```ts
export const explainValidationFindings = createTool({
  name: 'explainValidationFindings',
  description: 'Explain supplied deterministic validation findings.',
  parameters: {
    type: 'object',
    properties: { findings: { type: 'string' } },
    required: ['findings'],
    additionalProperties: false,
  } as const,
  function: ({ findings }, context) =>
    context.createSubtasksResult([
      [
        {
          role: 'system',
          content: {
            type: 'message',
            data: `Explain these findings without changing their factual status:\n${findings}`,
          },
        },
        toolCall({
          name: 'chatCompletion',
          arguments: { allowedTools: [] },
        }),
      ],
    ]),
})
```

Operational autonomy and model discretion are separate. A deterministic tool can complete a
workflow autonomously, while a highly model-directed tool may still pause for approval. State which
inputs remain local, reach a model, or reach another external service.

Skills and MCP occupy different boundaries. A skill supplies reusable instructions and resources;
an agent can compile its stable procedure into a tool. MCP transports tool discovery and calls
across a process or network boundary. See [Tools, Skills, and MCP](../user/tools-and-mcp.md) and
[Agent-Authored Tools](agent-authored-tools.md).

## Scoped tools, lambda, and bind

A `tooldefinition` task declares a tool only for the following lineage. Name-only calls use the
nearest preceding scoped definition before a registry tool with the same name. Scoped definitions
are never installed in the central registry and cannot contain a privileged native `function`.
They contain either sandboxed `code` or a declarative binding `implementation`.

Use `lambda(definition, chatArgs)` to append the definition and the immediately following
`chatCompletion`. The helper owns `allowedTools` and `toolChoice`, so the model sees and must call
only the declared signature. Use `bind(...)` when that signature should call an existing tool with
some fixed arguments and a smaller public schema:

```ts
bind({
  name: 'selectTaskyonTools',
  description: 'Select relevant tools.',
  target: 'taskyonFlow',
  fixedArguments: { use_tool_chooser: false },
  publicArguments: {
    allowedTools: {
      description: 'Candidate tool names.',
      maxItems: 20,
    },
  },
})
```

The public argument entries refine the target's existing JSON Schema rather than replacing its
types. Fixed arguments cannot also be public. Core compiles the generated target call with an
immutable tool revision and an opaque per-tool settings revision. Defaults and settings are applied
only during execution, so settings values are not exposed in the task tree. Repeated definition
occurrences remain in the call stack while equal definition content shares storage. Definition
tasks do not become model messages or ordinary copied chat content.

## Internal and client tools

Use `createTool(...)` for tools executed by Taskyon core. Use `createClientTool(...)` for a
capability supplied by a browser, CLI, iframe host, MCP bridge, or another protocol client. Client
tools cross a message-port boundary and receive only the context capabilities registered by their
host.

Do not use a client tool merely to split code into another process. The boundary is useful when the
host owns the capability, such as a file picker, editor action, shell, privileged API, or product
UI. Keep runtime-neutral logic in ordinary functions and call it from the owning tool.

## Tool context

Context projection belongs to the executing tool. Shared Taskyon core supplies neutral task access,
while tools such as `chatCompletion` decide which parents, siblings, and child results their reducer
needs. Promote traversal logic to a shared tool utility only when multiple tools need identical
semantics.

The execution context can provide:

- `getExecutionTaskChain()` to read the chain projected for the current task;
- `createSubtasksResult(...)` to return visible sequential or parallel workflow branches;
- `resolveInvocation(...)` to request opaque revisions for one named target on demand;
- `getSecret(...)` and `setSecret(...)` for the current tool's secret namespace;
- `getCallingToolId()` when delegated work needs the resolved caller identity;
- `stopSignal` for cancellation;
- `toolId` for the generated tool identity;
- optional typed `fetch(...)`, popup, progress, and interaction capabilities supplied by the host.

External tool contexts intentionally make unavailable capabilities fail instead of silently
granting core access. A direct RPC call may also lack a task ID, in which case
`getExecutionTaskChain()` is unavailable.

## Results and workflow state

A plain return value becomes the tool result interpreted by the active entry node. Use an explicit
subtask result when the number, order, branching, role, or terminal condition matters. The visible
shape should remain near the return:

```ts
return context.createSubtasksResult([
  [analysisTask, toolCall({ name: 'lookup', arguments: query }), reducerTask],
  [independentCheck, checkReducer],
])
```

Each inner array is sequential; multiple inner arrays can execute independently. Long-running or
iterative tools should return continuation or reducer tasks. They should not call the task
processor in a hidden loop or store progress in module state.

Use task content deliberately:

- `message` for conversation or instructions;
- `tool` for an explicit tool call;
- `structured` for typed data consumed by another task;
- `return` for terminal workflow output;
- `error` for a visible failure.

See [Task Processing](task-processing.md) for context selection and settlement rules.

## Parameters, settings, and tool selection

The `parameters` JSON Schema is the source of truth for arguments and defaults. Settings UI should
read the runtime tool schema rather than importing a parallel settings schema. Keep local option
types near the tool unless they carry reusable domain meaning.

Each tool owns its model-facing guidance. Use `description` for a concise catalog summary that says
what the tool does and when to select it. Add an optional `longDescription` only for tool-wide
operational details that improve correct use: workflow, visible side effects, execution boundaries,
result semantics, or important limitations. Do not repeat the short description or copy individual
argument documentation into it. It must still stand alone because callable declarations use it in
place of the short text. Put argument meanings, constraints, defaults, interactions, and
examples in the owning parameter schema; complex values should include schema examples.

Catalog search and shortlisting use the short description. Once a tool is callable, Taskyon sends
its long description when present and otherwise falls back to the short description. Entry nodes
and global prompts must not maintain parallel named-tool guidance or rewrite descriptions.

Use `allowedTools` when a workflow intentionally restricts the next model decision. An empty or
omitted list can mean that the entry-node configuration supplies its normal tool set, so do not
treat it as a universal denial list without checking the active mode.

Return clear errors with enough context for an entry node or reducer to decide whether to retry,
request clarification, choose another tool, or stop.

## Trust and dependencies

Tool code runs with the capabilities of its runtime unless an external sandbox narrows them.
Browser CSP, iframe isolation, message ports, process boundaries, and MCP approval are separate
controls; a tool declaration alone is not a security boundary.

Run tool implementations in a sandbox when their required capabilities are available through its
explicit context. Reserve trusted typed functions for host capabilities that cannot safely or
practically execute there, and keep privileged effects in narrowly scoped host tools. Sandboxed
tools can compose those capabilities through explicit child tool calls.

For local browser debugging only, `VITE_TASKYON_TOOL_EXECUTION=main-thread` can isolate
sandbox-specific failures. Do not enable this override in committed test commands, CI, or
production; regression diagnostics must continue to exercise the sandboxed path.

Before adding a third-party library, check browser and Node compatibility, package size, license,
network behavior, and whether the same capability already exists. Prefer established libraries for
complex domain behavior, but keep Taskyon workflow semantics in visible task nodes rather than
inside library callbacks.

The current peer advertises its FRP services, streams, and registered tools at
[`/resources/peers/local/api`](/resources/peers/local/api). This runtime OpenAPI document is the
tool and protocol reference; it changes when the registered capabilities change. TypeScript SDK
interfaces remain owned by the exported package source.
