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
- `getSecret(...)` and `setSecret(...)` for the current tool's secret namespace;
- `stopSignal` for cancellation;
- `toolId` for the generated tool identity;
- an optional `messagePort` when the host explicitly supplies one.

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

Use `allowedTools` when a workflow intentionally restricts the next model decision. An empty or
omitted list can mean that the entry-node configuration supplies its normal tool set, so do not
treat it as a universal denial list without checking the active mode.

Tool descriptions should state observable behavior, required inputs, and important side effects.
Return clear errors with enough context for an entry node or reducer to decide whether to retry,
request clarification, choose another tool, or stop.

## Trust and dependencies

Tool code runs with the capabilities of its runtime unless an external sandbox narrows them.
Browser CSP, iframe isolation, message ports, process boundaries, and MCP approval are separate
controls; a tool declaration alone is not a security boundary.

Before adding a third-party library, check browser and Node compatibility, package size, license,
network behavior, and whether the same capability already exists. Prefer established libraries for
complex domain behavior, but keep Taskyon workflow semantics in visible task nodes rather than
inside library callbacks.

The current peer advertises its FRP services, streams, and registered tools at
[`/resources/peers/local/api`](/docs/taskyon/openapi/taskyon-peer-api). This runtime OpenAPI document is the
tool and protocol reference; it changes when the registered capabilities change. TypeScript SDK
interfaces remain owned by the exported package source.
