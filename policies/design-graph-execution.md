# Design Graph Execution Policy

Apply this policy to `dagCore`, stored or dynamic DAG nodes, design-graph persistence, graph
patching, studies, optimization, and computation caching.

The architectural direction is defined in
[`taskyon-design-graph-architecture-proposal.md`](../../taskyon-design-graph-architecture-proposal.md).
This policy contains durable implementation invariants, not a claim that every proposed capability
already exists.

## Demand-driven Evaluation

- Evaluate a node dependency only when the running node explicitly calls its `use.<alias>`
  capability.
- Preserve the same lazy semantics for direct nodes, stored nodes, sandbox adapters, browser and
  Node runtimes, run paths, studies, and optimizers.
- Never resolve every declared input merely to adapt one node representation to another.
- Keep repeated evaluation behind the owning computation cache; laziness must not introduce a
  parallel memoization source.
- Propagate cancellation, timeout, validation failures, and dependency errors through the same
  explicit call path.

## Immutable Identity And Persistence

- Treat exact upstream input references as part of an immutable applied node's computation
  identity.
- Create replacement downstream paths for semantic edits; never mutate an existing hashed node in
  place.
- Use one current stored-node format. Incompatible changes require an explicit version migration,
  regenerated hashes, and focused diagnostics rather than permissive legacy adapters.
- Keep creation task IDs, timestamps, and conversational provenance outside computation identity
  unless they affect behavior.
- Represent a cache lookup as one canonical computation hash derived from the node content hash and
  behavior-affecting parameters. Do not persist serialized node names, versions, or parameter
  descriptions as cache keys.
- Treat edge lists, local-name indexes, diagrams, and other graph views as derived data when
  immutable node input references are authoritative.
- Keep design revisions, task-tree provenance, and run records distinct: revisions select the
  design problem, task trees explain it, and runs evaluate it.

## Structural Variation

- Use core structural combinators only when the engine must understand a construct for execution
  planning, activity, identity, or optimization.
- `oneOf` evaluates only its selected provider. Compatible alternatives must agree on shape,
  units, coordinate systems, semantics, validity, and failure behavior, or use explicit adapters.
- `explode` exposes candidate-array selection to planning and optimization without making domain
  candidates special core node types.
- Keep ordinary deterministic conditions and transformations in ordinary nodes. Do not add a new
  engine node for each convenience operation.
- Do not claim to infer inactive inputs hidden inside arbitrary executable code.

## Parameters And Optimization

- Derive structural activity automatically from the demanded root closure, selected `oneOf`
  providers, and exploded candidates.
- Keep opaque conditional parameters conservatively active unless validated metadata describes
  them.
- Report empirical numerical sensitivity separately from structural inactivity.
- Distinguish design algorithms inside the graph from search strategies operating over exposed
  parameters.
- When multiple search strategies share a problem, coordinate them through one incumbent, history,
  cache, objective, constraint set, and stopping policy.

## Artifacts, Security, And Runtime Boundaries

- Validate dynamic node records, parameters, dependency requests, and outputs at their owning
  boundaries.
- Execute untrusted dynamic code in the Taskyon sandbox with only explicitly granted
  capability-scoped protocols.
- Do not expose ambient filesystem, network, UI, storage, or secret access to node code.
- Treat content hashes as byte or computation identity, not proof of correctness, authorization,
  safety, or confidentiality.
- Keep computation and artifact identity distinct: cache records map a computation hash to the
  content hash of the exact serialized result.
- Keep large or domain-specific values in content-addressed artifacts and include their hashes in
  computation identity when they affect behavior.
- Stream large values through bounded temporary chunks and publish one whole artifact under its
  final content hash. Do not create a second persistent chunk-addressing layer or chunk manifest.
- Represent conversions between artifact formats as explicit, inspectable graph nodes.

## Diagnostics

- Every stored-node format or execution adapter change includes a focused diagnostic that runs the
  production path.
- Diagnostics must prove that an unrequested dependency remains unevaluated, including across the
  sandbox boundary.
- Shared design-graph semantics run in browser and Node/CLI unless an unavailable capability is
  explicitly modeled at registration.
- Patch and revision diagnostics preserve old roots and prove deterministic replay after creating
  replacement paths.
