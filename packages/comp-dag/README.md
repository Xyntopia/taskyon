# `@taskyon/comp-dag`

Private computational DAG, study, optimization, query, and run-persistence infrastructure.

The root export provides `dagCore.ts`. Subpath imports expose schema helpers, dynamic node records,
optimization, query compilation, worker execution, and result persistence.

This package is experimental and is not a stable external API. Callers should use its package
exports rather than relative paths. DAG nodes carry explicit parameter/output schemas and execute
through caller-provided storage and execution boundaries.

Focused tests live beside the owning modules and run through Taskyon diagnostics.
