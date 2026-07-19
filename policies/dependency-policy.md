# Dependency Policy

Apply this policy before adding, replacing, widening, or exposing a dependency.

## Decision Order

1. Search for an existing owned implementation or dependency already providing the capability.
2. Evaluate whether a small, well-tested AI-assisted implementation at the owning boundary can be
   produced and maintained more cheaply than a new dependency.
3. Use an established library for complex domain logic, security-sensitive primitives, parsers,
   protocols, physics, or standards where reimplementation creates material correctness risk.
4. Add a dependency only when its benefit exceeds its maintenance, security, bundle, runtime, and
   ownership cost.

AI-assisted implementation can reduce development cost, but it is not evidence that maintaining a
custom implementation is safer than using a proven library.

## Evaluation

- Check license, maintenance, security history, release stability, package size, transitive
  dependencies, and network or telemetry behavior.
- Confirm compatibility with every runtime that imports the owning module.
- Prefer narrow imports and tree-shakeable packages over broad utility barrels.
- Keep published or embedded client packages small and avoid pulling server, UI, or broad shared
  surfaces across their boundary.
- Do not add two libraries for the same responsibility without a documented migration reason.
- Keep optional runtime capabilities optional; do not force a dependency into shared core solely
  to support one host.

## Ownership

- Add the dependency at the package that owns its behavior.
- Wrap a dependency only when the wrapper enforces a meaningful domain contract, isolates an
  unstable external API, or has multiple callers.
- Do not create pass-through wrappers merely to rename imports.
- Tests should exercise the owned boundary rather than reproduce the dependency's implementation.
