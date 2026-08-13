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

- Each tool owns its selection and usage guidance. Entry nodes, catalog routers, and global runtime
  prompts must not maintain named-tool instructions or rewrite tool descriptions.
- Keep `description` concise and discriminative: state what the tool does and when an agent should
  select it. Catalog search and shortlist stages use this short description.
- Add `longDescription` only when tool-wide operational guidance materially improves correct use.
  Describe workflow, observable side effects, execution boundaries, result semantics, or
  limitations that apply to the tool as a whole. Do not repeat the short description or document
  individual arguments there, and do not expose implementation details that cannot affect use.
  Because the callable declaration uses it in place of the short text, it must still stand alone.
- The parameter schema owns each argument's meaning, constraints, defaults, interactions, and
  examples. Add schema examples for complex or non-obvious values.
- Callable tool declarations use `longDescription` when present and otherwise fall back to
  `description`; catalog projection always remains concise.
- The tool parameter schema owns tool arguments, defaults, and tool-specific settings.
- A tool declaration's description owns when the tool should be selected and its observable
  behavior. Parameter descriptions own argument semantics. Do not duplicate tool-specific
  selection rules in an entry-node catalog prompt.
- Settings interfaces must read runtime tool schemas rather than import a parallel settings
  schema.
- When settings ownership moves, update defaults, configuration, and every settings surface
  together.
- Use the executor's materialized tool arguments as the runtime source of truth instead of
  manually threading parallel configuration into tools.

## Skills, Tools, And Model Discretion

- Treat a skill as reusable instructions, references, templates, and optional scripts that teach
  an agent a procedure. Treat a Taskyon tool as a typed executable capability. Do not present an
  instruction-only skill as if it provides deterministic execution.
- Treat MCP as a protocol for discovering and calling capabilities across a boundary, not as the
  implementation semantics of the imported or exported tool. Local tools do not need an MCP
  server; remote tools retain the cost, trust, and data boundary of their service.
- Implement stable parsing, validation, calculations, commands, and known decisions in ordinary
  code. Add `chatCompletion` only for a specific semantic decision that cannot be represented
  correctly and maintainably as deterministic behavior.
- Keep model calls visible in task chains and distinguish tool-creation model use from later tool
  execution when measuring cost, privacy, or reproducibility.
- Record which inputs remain local, reach a model provider, or reach another external service.
- Apply the same schema, sandbox, capability, replacement, and verification rules to agent-authored
  tools as to human-authored tools. Installation alone is not successful verification.

## Prompt Ownership

- Reusable model instructions belong to the owning tool's configurable prompt templates. Shipped
  browser defaults belong in `src/assets/taskyon_settings.json`; CLI defaults belong in
  `packages/tycli/src/taskyon_settings.json`. Every host must supply a complete prompt declaration
  through `ToolchainProfiles` rather than relying on prose embedded in tool code.
- Mark required prompt-template objects and fields as required in the owning tool schema. Prompt
  values belong in host settings, not schema defaults or runtime fallback constants; missing
  templates are configuration errors.
- Tool code may select a prompt mode and interpolate runtime context. Do not hardcode reusable
  prose in routing branches.
- Keep stable instructions in prepended prompts and append dynamic context afterward so stable
  prefixes remain reusable.
- Catalog prompts describe the generic routing operation only. The catalog entries' tool
  descriptions remain the single source of truth for individual capabilities.
- When prompt fields change, replace the schema and every shipped host declaration together. Do
  not retain unused legacy fields or compatibility aliases unless migration is explicitly required.

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

## Scoped Tools And Bindings

- Treat a `tooldefinition` task as a lexical definition for the following lineage. Resolve the
  nearest preceding definition with the requested name before the central registry.
- Never install task-tree definitions in the central tool registry. The registry owns
  host-registered tools; the task tree owns only its scoped definitions.
- Persist only sandboxed `code` or declarative `implementation` definitions in task trees. Native
  `function` implementations remain privileged application code and must not cross this boundary.
- A binding pins its registry target revision, fixes private arguments, and exposes a derived
  subset of the target schema. It may refine public descriptions and constraints, but it must not
  expose a fixed argument again.
- Compile a binding's generated target call with an immutable target `toolRevision` and, when that
  target has configuration, an opaque per-tool `settingsRevision`. Do not copy settings values into
  the task or expose them to the calling tool.
- At execution, apply schema defaults from the pinned tool revision, then the pinned settings
  snapshot, then explicit and materialized call arguments. Never fall back to ambient current
  settings when a call lacks or cannot resolve its settings revision.
- `lambda(...)` and `bind(...)` append a scoped definition followed immediately by a chat
  completion that exposes and forces only that tool.
- Preserve every submitted task occurrence and its chain links. Content storage deduplicates equal
  immutable definition content without deleting repeated definition occurrences from the tree.
- Hide definition tasks from model messages and ordinary chat/copy output. Expert diagnostics may
  render them for inspection without changing model context.

## Capability Isolation

- Taskyon core owns neutral task storage, traversal, scheduling, and execution capabilities. Each
  tool owns how it selects, folds, and interprets task-tree context for its reducer.
- Execute tool implementations in a sandbox whenever their required capabilities are available
  through the sandbox's explicit context. Use a trusted typed function only for host capabilities
  that cannot safely or practically run there.
- Keep privileged effects in narrowly scoped host tools. Sandboxed tools may compose those
  capabilities through explicit child tool calls in the task tree.
- Let sandboxed tools call `resolveInvocation({ name, ...pins })` when they need opaque revisions
  for one target. This capability must not return settings values or broad registry access.
- `VITE_TASKYON_TOOL_EXECUTION=main-thread` is a browser-development override for diagnosing
  sandbox-specific failures. Never enable it in committed test commands, CI, or production;
  regression diagnostics must continue to exercise the sandboxed path.
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
