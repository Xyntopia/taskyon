# `@taskyon/comp-dag`

Private computational DAG, study, optimization, query, and run-persistence infrastructure.

The root export provides `dagCore.ts`. Subpath imports expose schema helpers, dynamic node records,
optimization, query compilation, worker execution, and result persistence.

This package is experimental and is not a stable external API. Callers should use its package
exports rather than relative paths. DAG nodes carry explicit parameter/output schemas and execute
through caller-provided storage and execution boundaries.

Mounted nodes can be projected into Taskyon tools through the shared `createDagNodeTool` adapter.
The node remains the owner of its name, schemas, execution, version, and cache behavior; Taskyon
adds only capability-origin metadata and conversation/search routing.

Focused tests live beside the owning modules and run through Taskyon diagnostics.
