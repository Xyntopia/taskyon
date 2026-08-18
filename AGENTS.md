# Agent Instructions

Read the canonical
[Taskyon Core Policies](public/docs/developer/core-policies.md) before every
change. They are the public project philosophy and apply to agents and human contributors alike.

The operational rules in this file apply to every agent change. The routing table at the end points
to additional stable policies for specialized work.

Do not use this file as evidence of current commands, package layout, versions, feature support, or
implementation status. Inspect the current owning code, configuration, package README, or active
developer documentation for those changing facts.

When project principles compete, use the order in the core policy document. Correctness and the
user's requested scope take precedence over implementation preferences. State any material
tradeoff.

## External Proposal Ownership

Taskyon is an independent repository. Architectural proposals are maintained outside this source
repository, and this project does not assume a particular parent project, deployment repository, or
proposal path. Before creating or editing a proposal, ask the maintainer which external repository
and path should own it. Keep Taskyon policies and documentation focused on implementation
invariants and current behavior; do not add deployment-specific proposal paths or links here.

## Protocol Discipline

- Treat every protocol command as a capability that could be exposed across a future P2P boundary.
- Use typed protocols at real runtime, service, storage, and ownership boundaries even when the
  current provider is local or in-process. Consumers must not depend on whether the implementation
  runs locally, in a worker, on another process, or on a peer.
- Keep client behavior and protocol semantics location-transparent. Select and connect an adapter
  at the composition boundary instead of branching throughout consumers on local versus remote
  placement.
- Keep protocols focused on intentional remote capabilities and canonical data exchange. Do not
  add graph traversal, filtering, ranking, aggregation, or other convenience queries merely to
  simplify a local consumer.
- Before extending a protocol, prove that the behavior cannot be derived cleanly from locally
  available canonical records using a cache or rebuildable index.
- When local data is incomplete, prefer synchronizing or fetching the smallest canonical records
  needed and derive views locally instead of adding a specialized remote query.
- Expose derived computation through a protocol only when performing that computation remotely is
  itself the intended, capability-scoped service, with explicit trust and authorization semantics.
- Do not turn ordinary calls within one cohesive implementation into protocol traffic. Keep local
  implementation details as direct typed functions and introduce a protocol where it removes a
  genuine ownership, lifecycle, runtime, trust, or replaceability coupling.

## Root Cause And Evidence

- Trace requests and failures to the highest owning source before editing consumers.
- Read the relevant call flow, types, tests, logs, generated output, and runtime behavior before
  deciding on a change.
- Revise the approach when evidence contradicts the initial assumption.
- Fix values and types at their source instead of patching symptoms downstream.
- Validate dynamic data once at its domain boundary, convert it to a strong type, and pass that
  typed value downstream.
- When a persisted schema changes incompatibly, handle migration or version invalidation at the
  schema owner instead of adding scattered consumer cleanup.
- If a narrow change starts causing broad unrelated churn, stop and reconsider the ownership
  boundary rather than spreading workarounds.
- If typing cannot be made correct without weakening the contract, stop and explain the blocker.

## Type Safety

- Do not use `as any`, `as unknown as`, JSON round trips, broad type widening, or type invalidation
  to silence errors.
- Do not add generic `isRecord`-style guards. Narrow dynamic input with a domain-specific parser at
  the real boundary.
- Do not return fake no-op implementations to preserve an API shape. Model unavailable
  capabilities explicitly as optional.
- Do not create parallel local types or schemas that duplicate an owning public or domain
  contract.
- Keep types close to their use. Name them when they carry domain meaning, are reused, form a
  public boundary, or are genuinely complex.
- Do not create thin TypeScript files whose only purpose is to relocate types from their owning
  component or module. Keep public contracts in their owner unless a separate type module has
  substantial domain ownership and is explicitly justified.
- Prefer inference for local variables, callback parameters, and implementation return types.
  Declare named types when they define a public boundary, are recursive or reused, or materially
  improve readability; do not annotate code merely because a type can be written down.
- Keep Vue component props, emits, slots, and other component-specific contracts in the owning
  `.vue` file. When a plain TypeScript consumer cannot resolve an SFC type through typed ESLint, do
  not duplicate the contract or disable the rule. Extract a TypeScript module only when it owns a
  meaningful non-visual model or behavior shared across the boundary; otherwise keep the consumer
  at the Vue boundary.
- Do not add declaration-generation infrastructure solely to work around one SFC import. Use
  generated declarations when the owning package already has, or genuinely needs, a compiled
  public API boundary.
- Keep small local unions and implementation options inline or in one nearby options type.
- Require an explicit `mode` or `method` when callers must choose among strategies.
- Keep unrelated controls separate instead of combining them into one options object.

## Critical Evaluation

- Evaluate requests for duplication, hidden state, unnecessary coordination, weak ownership, and
  simpler existing mechanisms.
- Do not treat a requested implementation shape as correct merely because it was suggested.
- Prefer extending the existing source of truth over creating a parallel helper, schema, type, or
  state path.
- Search for existing equivalent logic before adding code.
- Explain concrete risks and alternatives when pushing back.

## General Programming Guidelines

- Prefer pure or stateless functions and explicit dependency passing.
- Prefer composition over inheritance and functions over classes unless a class owns meaningful
  lifecycle or protocol state.
- Keep side effects isolated at explicit runtime, storage, network, or UI boundaries.
- Keep runtime values out of module scope by default. Declare mutable state,
  service instances, registries, caches, and derived values inside the owning
  function, composable, or factory, and pass dependencies explicitly. This
  keeps initialization lazy, makes ownership visible, and supports effective
  tree shaking. Module scope should normally contain imports, types, and pure
  stateless functions; use a top-level immutable constant only for a genuinely
  shared static value or public API, never for eager construction or side effects.
- Prefer immutable values, declarative transformations, and explicit control flow.
- Keep functions focused. Around 40 lines is a useful target; split when responsibilities become
  difficult to understand, not to manufacture abstraction.
- Reuse existing helpers and extract new helpers only when they remove real duplication or clarify
  a non-trivial domain step.
- Do not add pass-through wrappers, default factories, hidden module captures, or nesting layers
  that only rename, bind, or forward another operation.
- Keep workflow and resumable state in caller-provided values, task data, persisted artifacts, or
  other inspectable records instead of hidden process state.
- Do not use hidden global or module state for values that can be passed explicitly.
- Prefer currying only when it makes composition or reuse clearer.
- Optimize local readability before speculative reuse or abstraction.
- Prefer explicit function and event flow over implicit synchronization.

## Scope And Repository Care

- Implement only the requested behavior and the changes required to make it correct.
- Do not refactor adjacent code merely because it could be improved.
- Preserve unrelated worktree and index changes.
- Work with overlapping user changes instead of reverting them.
- Do not use destructive Git commands unless the user explicitly requests the operation.
- Use current repository configuration as the source of truth for commands, formatting, versions,
  and package layout.

## Tests, Documentation, And Formatting

- Write or update the targeted test before implementation when a change requires a behavioral or
  regression test.
- Keep tests focused on the requested behavior and use production sources of truth rather than
  duplicating helpers in tests.
- Add meaningful behavior to the normal diagnostics boundary where the project uses diagnostics.
- Run focused type checks, diagnostics, and tests for the changed ownership boundary.
- Never weaken a test to make it pass.
- Update relevant documentation when behavior, workflow, runtime configuration, or a public
  ownership boundary changes.
- Include Mermaid workflow updates when an affected document uses such a diagram.
- Format every file you edit using the repository formatter, targeting only edited files.
- Do not run lint or lint-fix unless the user explicitly requests it. When requested, target only
  the relevant files unless the user asks for a broader pass.
- Do not automatically run slow test suites unless explicitly requested or justified by the scope.
  Targeted checks are preferred.
- Report which checks ran, what did not run, and any environmental limitation.

## Specialized Policy Routing

Read every additional policy matching the work:

| Work in scope                                                                                           | Required policy                                |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Taskyon tools, entry nodes, task chains, tool settings, or tool context                                 | `policies/tools-and-workflows.md`              |
| Ports, protocols, iframe/host boundaries, browser/Node boundaries, P2P, or remote tools                 | `policies/protocols-and-runtime-boundaries.md` |
| Persistence, projects, files, OPFS, databases, secrets, encryption, remote caches, or shared storage    | `policies/local-first-storage-and-security.md` |
| Tests, diagnostics, LLM tests, or cross-runtime verification                                            | `policies/testing-and-diagnostics.md`          |
| Design graphs, DAG execution, stored nodes, graph patches, studies, optimization, or computation caches | `policies/design-graph-execution.md`           |
| Adding, replacing, or widening a dependency                                                             | `policies/dependency-policy.md`                |
| Package exports, cross-package imports, published clients, generated configuration, or schema owners    | `policies/package-and-configuration.md`        |
| Git state, branches, commits, merges, rebases, backports, submodules, or nested repositories            | `policies/repository-workflow.md`              |
| Vue, UI state, routes, styling, or user interaction                                                     | `policies/frontend.md`                         |
| `tycli` implementation, debugging, or autonomous evaluation                                             | `policies/tycli-development.md`                |
| Modelica compiler, generated code, templates, runtime, libraries, or simulation                         | `policies/modelica-development.md`             |
| Any Rumoca work, including integration upgrades and comparison runs                                     | `policies/rumoca-development.md`               |

Read multiple policies when a change crosses multiple boundaries. A P2P DAG cache, for example,
requires the protocol, storage/security, dependency, and testing policies.

## Policy Use

- The nearest `AGENTS.md` adds narrower instructions for its subtree.
- Policy documents define durable decision rules. They are not evidence of current software
  behavior.
- When exact commands, paths, versions, schemas, or supported features matter, inspect their
  current owning source.
- Do not bypass a policy by moving the implementation to a different layer.
