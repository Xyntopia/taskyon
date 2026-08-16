# Design Graph Execution Policy

Apply this policy to `dagCore`, stored DAG nodes, design-graph persistence, graph patching,
invocations, studies, optimization, execution runs, artifacts, and computation caching.

The architectural direction may be defined by accepted proposals maintained outside this
repository. Taskyon does not assume where those proposals are stored; agents must ask the
maintainer for the external repository and path before creating or editing one. This policy
contains durable implementation invariants, not a claim that every proposed capability already
exists.

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
- Plan invocation domains as pull-based row streams with backpressure. Do not eagerly create a full
  Cartesian-product array or accumulate a complete study result before dependent processing can
  begin.
- Treat independent dimensions as a joint product search space without requiring the planner to
  enumerate it. Represent paired or correlated values explicitly rather than inferring a zip from
  row order.

## Immutable Identity And Persistence

- Keep one immutable design-graph object model and content identity across spaces. A user's
  effective graph is derived from authorized personal refs, mounted collaborative refs and graph
  closures, and locally cached immutable objects; a project must not own or copy a node catalog.
- Scope mutable graph and project refs to a space. Model a project branch as a space-owned stable
  ref to an immutable project revision. A revision contains parent
  hashes, an editable display name, friendly invocation-name-to-hash references, and optional
  namespaced extension hashes. Invocation roots select the project's computational closure; do not
  duplicate those roots in the project.
- Allow the same immutable project revision to be referenced by personal and collaborative refs.
  Sharing publishes only the selected revision and exact required graph closure into the target
  space; it must not expose either participant's complete personal graph.
- Preserve ref and object provenance so edits advance the intended space-owned ref. Treat personal
  and collaborative refs as explicit branches that may diverge rather than silently merging them.
- Keep project revision ancestry explicit. Set parents when creating a revision, never mutate them,
  and use zero, one, or multiple parents for initial, ordinary, or merge revisions respectively.
- Use the same graph, project, invocation, run, artifact, ref, extension, and Git-projection records
  in Taskyon and Joulios. Host applications must not introduce a parallel project or graph format.
- Browser and CLI hosts for the same application must consume one canonical repository projection
  and expose the same authorized graph refs, project refs, template projects, invocations, and runs.
  Runtime-specific storage adapters may hold separate local replicas, but they must not define
  runtime-specific examples, node catalogs, study manifests, or result schemas. Synchronization or
  explicit repository transfer connects replicas; direct access to another runtime's private
  filesystem is not part of the domain model.

- Treat exact upstream input references as part of an immutable applied node's computation
  identity.
- Create replacement downstream paths for semantic edits; never mutate an existing hashed node in
  place.
- Use one current stored-node and repository format. During early development, incompatible
  changes invalidate old local data and regenerate bundled hashes; do not retain compatibility
  readers, legacy types, aliases, or parallel persistence paths.
- Distinguish only how a node is provided: hard-coded by a trusted runtime, or loaded from a stored
  TypeScript file in the writable design-graph repository. Both compile to the same `DagNode`
  execution type; do not create a separate dynamic-node category, registry, execution path, or
  persistence format.
- Stored nodes are always editable through immutable replacement revisions. Treat bundled,
  directory, Git, peer, and other external node files as import sources: validate and persist them
  through StorageClient before exposing them as stored nodes. Do not mount read-only stored nodes
  or add a separate editability capability.
- Resolve every stored-node import through an immutable content-addressed module lock included in
  node identity. A lock target is either a content-addressed first-party module or an approved
  package requirement. Store first-party module artifacts and lock objects in the design-graph
  repository and include only that first-party closure in Git projections. Never store third-party
  package source, package archives, or a `node_modules` tree in graph storage. Import-free nodes do
  not require a meaningless empty lock.
- Keep `use.<alias>` exclusively for declared DAG dependencies. Inject network and host operations
  through separate typed services; never disguise a capability as a computational input or expose
  unrestricted host RPC.
- Authorize stored-node network access by immutable node hash, origin, and read/write access. Reuse
  the decision for repeated rows in one compiled execution context and revoke it by ending that
  context or through the owning capability policy.
- Keep planner-generated reducers, query expressions, and structural nodes internal and invisible.
  Keep trusted runtime nodes under an explicit `builtIn` source directory or registry; do not mix
  them with editable stored-node definitions.
- Supply the definition origin (`hard-coded` or `stored`) explicitly when composing a runtime
  graph. Absence from a host lookup is not itself authoritative origin information.
- Use content hashes as graph identity whenever available. Local names and labels are presentation
  and lookup conveniences; do not use them to decide immutable graph membership, provenance, or
  replacement relationships.
- Keep DAG indexing, closure traversal, visualization records, immutable input rewrites, dependent
  deletion checks, and default-record merging in `@taskyon/comp-dag`. Host applications may select
  roots and supply capabilities or labels, but must not duplicate these graph algorithms.
- Encode canonical SHA-256 node, computation, revision, and artifact identities as unpadded
  base64url after the `sha256:` prefix.
- Keep creation task IDs, timestamps, and conversational provenance outside computation identity
  unless they affect behavior.
- Represent a cache lookup as one canonical computation hash derived from the node content hash and
  behavior-affecting parameters. Do not persist serialized node names, versions, or parameter
  descriptions as cache keys.
- Treat edge lists, local-name indexes, diagrams, and other graph views as derived data when
  immutable node input references are authoritative.
- Keep design revisions, task-tree provenance, and run records distinct: revisions select the
  design problem, task trees explain it, and runs evaluate it.
- Keep friendly invocation names in project revisions, outside invocation identity. Do not store
  hash-excluded display fields inside immutable invocation objects.
- Keep computational-node inputs computational-node-only. Compose stored invocations, target nodes,
  plots, and reports in the invocation/planner layer rather than adding an invocation input variant
  to `DagNodeRecord`.

## Meaningful Editable Nodes

- Every ordinary user-visible stored node must own a meaningful operation that can be understood and
  changed in the node editor: domain validation or normalization, transformation, calculation,
  aggregation, an explicitly declared effect, or composition that demands computational inputs.
- Do not add a stored node whose run function only returns its parameters unchanged, forwards one
  dependency unchanged, returns a placeholder value, or wraps a workflow solely to make the graph
  appear decomposed. Remove that node or put the real operation at that boundary.
- Keep ordinary first-party domain operations in their owning stored node so the node's Raw TS view
  contains the operation users are expected to understand and edit. Use stored first-party modules
  only for genuinely reusable low-level functions where representing the behavior as another DAG
  node would be misleading or impractical. A wrapper around an external domain function or an
  entire multi-stage workflow is not a substitute for representing those stages.
- Core structural combinators such as `explode`, planner-generated reducers, and derived query
  expressions are exempt from ordinary run-function requirements because the engine owns their
  execution semantics. Keep them explicitly structural and do not disguise them as editable domain
  nodes.

## Projects And Working Drafts

- Persist immutable nodes, invocations, and project extensions when created, while keeping the
  current project selection as a lightweight local working draft of hashes.
- Persist bounded draft undo/redo history locally through StorageClient without advancing the
  project ref. Default to 200 snapshots and allow a host setting to change the limit.
- Advance a project ref only through an explicit save that creates one new revision parented by the
  current ref target and uses an expected-current comparison.
- Allow execution of an immutable invocation referenced only by an unsaved draft, but expose that
  unsaved association clearly.
- Model bundled examples as ordinary template project refs. Opening one creates a new stable
  project ref at the same immutable revision; examples must not use a specialized execution path.
- Persist CLI studies intended for later inspection as ordinary project revisions, invocations,
  invocation runs, and named artifacts. A report directory may be an export of those records, but it
  must not become a CLI-only authoritative project or run store.
- Store deliberately saved workspaces, dashboards, and sandboxed views as typed, namespaced,
  content-addressed project extensions. Do not use an inline arbitrary `customSettings` object.

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
- Use one invocation definition for designs, explorations, and optimizations. Derive the display
  category from constant versus variable domains and the presence of objectives; do not persist a
  redundant high-level kind.
- Preserve a Pareto frontier for multiple objectives unless an explicit result-affecting invocation
  policy defines scalarization or priority.
- Keep result-affecting requested policy in the invocation. Keep worker placement, concurrency,
  progress cadence, storage location, and retention in engine settings with optional project-local
  operational overrides stored outside project revisions.

## Reducers And Planner Rewrites

- Implement path selection, mapping, filtering, indexing, and reducers once as structurally hashed
  internal derived expressions shared by node queries, planners, and views.
- Do not persist a second invocation terminal-operation language or generate editable stored nodes
  for runtime-derived operations.
- Treat runtime-derived operations as invisible execution-plan nodes. Their cache identity uses
  exact input artifact hashes and canonical operation semantics, not random names or display labels.
- Stream associative reducers through bounded state. An exact reducer blocks only downstream work
  that requires its final value; it must not materialize all rows.
- Flatten nested optimization semantics only through deterministic equivalence rules. Preserve
  minimax, bilevel, constrained, and non-monotonic relationships when flattening would change the
  answer.
- Default reducer accuracy to `auto`; resolve `auto` to `exact` until an estimator capability is
  implemented. Reject an explicit unavailable approximate request instead of silently changing its
  semantics.
- Discover reducers hidden in TS control flow during planning when encountered. Allow invocations
  to override a discovered reducer by a stable semantic address, use `auto` for unseen reducers,
  and report overrides orphaned by node changes.

## Artifacts, Security, And Runtime Boundaries

- Validate stored node records, parameters, dependency requests, and outputs at their owning
  boundaries.
- Execute untrusted stored node code in the Taskyon sandbox with only explicitly granted
  capability-scoped protocols.
- Accept only statically analyzable JavaScript/TypeScript imports. Resolve approved package names
  against a host-shipped manifest; do not fetch npm packages, CDN modules, or package metadata at
  runtime. Keep the package allowlist and resolver generic and Taskyon-owned.
- Compile stored nodes outside the UI thread with tree shaking. Cache a self-contained executable
  artifact through StorageClient under the node hash, module-lock hash, compiler ABI, and exact
  resolved package identities. A package range belongs in the immutable lock; the exact provider
  version and integrity belong in the compiled artifact and run provenance.
- Repository loading is metadata-only. Compile on save for validation, on explicit artifact
  inspection, or on first execution. Opening the Compiled view performs a cache-only read until the
  user explicitly requests compilation.
- Expose Raw TS, stored Modules, package Dependencies, and the read-only Compiled artifact for each
  editable stored node. Never present third-party package source as an editable stored module.
- Treat incompatible package updates as an explicit immutable graph rewrite that creates new locks,
  node hashes, dependent paths, and refs. Do not silently reinterpret an old lock after an app
  update.
- Use one sandbox worker per execution isolation boundary. Hosts may retain a bounded least-recently
  used set of idle sandboxes, but must never evict an active sandbox. Do not share a worker between
  trusted nodes until a separately reviewed trust and failure-isolation model exists.
- Do not expose ambient filesystem, network, UI, storage, or secret access to node code.
- Treat content hashes as byte or computation identity, not proof of correctness, authorization,
  safety, or confidentiality.
- Keep computation and artifact identity distinct: cache records map a computation hash to the
  content hash of the exact serialized result.
- Keep large or domain-specific values in content-addressed artifacts and include their hashes in
  computation identity when they affect behavior.
- Present large values to the graph as one logical artifact under its final content hash. The
  StorageClient may privately use encrypted descriptors and durable opaque chunks for streaming,
  repair, and replication; graph code must not acquire a second chunk-addressing API.
- Represent conversions between artifact formats as explicit, inspectable graph nodes.
- Keep mutable execution attempts separate from immutable terminal `InvocationRun` records. Attempts
  own progress and checkpoints; runs own terminal status, resolved policy, provenance, and named
  artifact hashes.
- Finalize valid partial artifacts for failed and cancelled runs when possible, but never reuse them
  as completed cache hits.
- Store run manifests by full invocation hash; prefix sharding is a repository implementation
  detail. Derive project run lists from project invocation hashes rather than storing mutable
  project run histories.
- Before reusing a run, verify every required artifact. Rebuild derived indexes and summaries from
  rows when possible and rerun the invocation when an irreducible result artifact is missing.
- Do not reuse a completed invocation run across a source-node observation check unless exact source
  manifests are part of reuse identity and remain valid under the requested freshness policy.
  Until that identity is implemented, bypass invocation-run reuse for source-node closures and let
  the source-node/DAG cache enforce freshness.
- Resolve `auto` and other result-affecting planner choices before cache selection. Key reusable
  runs by invocation plus resolved result-affecting planner/engine identity, not by operational
  settings that are guaranteed not to change results.
- Make row results and indexes range-readable so plots, tables, downloads, and downstream consumers
  can stream bounded selections without loading a complete run.
- Treat browser tables, plots, and result objects as disposable projections of invocation artifacts.
  Do not persist a second per-project result snapshot, per-row JSON archive, or run-history pointer
  in project state. A host may cache bounded decoded row ranges locally, but the immutable
  `InvocationRun` and its named artifacts remain authoritative.

## Diagnostics

- Every stored-node format or execution adapter change includes a focused diagnostic that runs the
  production path.
- Diagnostics must prove that an unrequested dependency remains unevaluated, including across the
  sandbox boundary.
- Shared design-graph semantics run in browser and Node/CLI unless an unavailable capability is
  explicitly modeled at registration.
- Patch and revision diagnostics preserve old roots and prove deterministic replay after creating
  replacement paths.
- Diagnostics cover bounded-memory row execution, reducer cache reuse, run-artifact completeness,
  draft/ref separation, complete Git ancestry, and exclusion of run products from Git snapshots.
