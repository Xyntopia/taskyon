# `@taskyon/comp-dag`

Private computational DAG, study, optimization, query, repository, Git-projection, and
run-persistence infrastructure.

The root export provides `dagCore.ts`. Subpath imports expose schema helpers, stored node records,
optimization, query compilation, worker execution, and result persistence.

The main ownership boundaries are:

- `dagCore.ts`: lazy runtime execution, studies, reducers, and node effects;
- `dagNodeRecord.ts` and `dagNodeRecordGraph.ts`: stored node format, closure traversal, immutable
  rewrites, and compilation;
- `dagModule.ts` and `dagModuleCompiler.ts`: immutable module artifacts, exact import locks, and
  sandbox-ready module-closure compilation;
- `builtIn/`: trusted generic query/runtime nodes that are not editable stored definitions;
- `dagGraphView.ts`: presentation-only projection of runtime nodes;
- `designGraphModel.ts` and `designGraphRepository.ts`: immutable graph, project, invocation, run,
  ref, and extension records over an injected object store;
- `dagGitProjection.ts`: validated global or closure-scoped Git snapshots and fast-forward-only
  synchronization;
- `sourceManifest.ts`: immutable source-observation locks and refresh policy.

This package is experimental and is not a stable external API. Callers should use its package
exports rather than relative paths. DAG nodes carry explicit parameter/output schemas and execute
through caller-provided storage and execution boundaries.

Stored TypeScript definitions and trusted hard-coded definitions compile to the same `DagNode`
type. Do not add a parallel dynamic-node runtime or infer editability from origin: stored nodes are
edited by creating immutable replacements in the repository.

Stored imports resolve only through a content-addressed module lock. The repository stores one
deduplicated copy of each locked module rather than a `node_modules` tree. Runtime services such as
mediated fetch are injected separately from `use`, which remains reserved for DAG dependencies.

Mounted nodes can be projected into Taskyon tools through the shared `createDagNodeTool` adapter.
The node remains the owner of its name, schemas, execution, version, and cache behavior; Taskyon
adds only capability-origin metadata and conversation/search routing.

Focused tests live beside the owning modules and run through Taskyon diagnostics.
