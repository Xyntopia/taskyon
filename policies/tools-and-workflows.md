# Taskyon Tools And Workflow Policy

Apply this policy when creating or changing Taskyon tools, entry nodes, task chains, tool settings,
or tool-visible capabilities.

## Tool Boundary

- Express a feature as a tool when it is a meaningful capability that should be composable,
  discoverable, inspectable, or reusable by an agent.
- Do not force internal implementation steps into separate tools when ordinary typed functions
  provide a clearer boundary.
- Before adding or refactoring a tool, inspect similar tools in the owning Taskyon tools package.
- Reuse established orchestration and re-entry patterns such as `createSubtasksResult`, `toolCall`,
  and `chatCompletion` instead of inventing a parallel workflow mechanism.
- Keep one tool's name, description, parameter schema, render options, and execution body readable
  together at the tool declaration.
- Extract implementation helpers only when they contain meaningful logic or are reused. Do not
  scatter a tool across parameter constants, wrapper factories, or delegated one-line runners.

## Source Of Truth

- The tool parameter schema owns tool arguments, defaults, and tool-specific settings.
- Settings interfaces must read runtime tool schemas rather than import a parallel settings
  schema.
- When settings ownership moves, update defaults, configuration, and every settings surface
  together.
- Use the executor's materialized tool arguments as the runtime source of truth instead of
  manually threading parallel configuration into tools.

## Explicit Workflow State

- Keep tools stateless wherever possible.
- Represent long-running work as visible task chains, branches, reducers, or continuation tasks,
  not hidden loops or internal task processing.
- Keep the number, order, completion, and branching shape of returned tasks visible near
  `createSubtasksResult(...)`.
- Treat executable tasks as reducers over visible prior tasks, selected child results, explicit
  arguments, and persisted artifacts.
- Keep top-level routing and entry-node flow visible in the tool body even when detail helpers are
  extracted.
- Use plain results for plain data and explicit task chains when workflow structure matters.

## Capability Isolation

- Taskyon core owns neutral task storage, traversal, scheduling, and execution capabilities. Each
  tool owns how it selects, folds, and interprets task-tree context for its reducer.
- Core must not import concrete tool implementations or impose an LLM-specific context policy.
- Promote a tool-specific utility to a shared tool utility only when multiple tools need the same
  semantics. Shared utilities remain stateless, dependency-injected, and independent of concrete
  tool implementations.
- Do not inject task managers, unrestricted task-store accessors, raw storage, parent windows, or
  ambient host capabilities into tool-visible context.
- Resolve task references and materialize dependencies at the executor boundary.
- Give external or client tools only the capabilities registered by their host.
- Model unavailable capabilities explicitly rather than returning fake implementations.
- Secret access, files, network access, UI actions, shell execution, and remote calls remain
  explicit capabilities with their own trust policy.

## Errors And Verification

- Return or throw errors that identify the failed operation and give a reducer or entry node enough
  information to retry, clarify, choose another tool, or stop.
- Do not swallow cancellation or convert unavailable capabilities into apparent success.
- Add focused diagnostics through the shared Taskyon diagnostics boundary for new tool behavior.
