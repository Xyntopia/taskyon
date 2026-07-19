# Package And Configuration Policy

Apply this policy when changing package exports, cross-package imports, shared or published
packages, generated configuration, persisted schemas, or configuration ownership.

## Package Boundaries

- Put behavior in the narrowest package that owns it.
- Import another package through its public exports. Do not reach into private source paths with
  cross-package relative imports.
- Keep shared packages independent of application-specific UI, server, filesystem, or commercial
  service code unless that dependency is the package's explicit purpose.
- Keep published clients small and convenient. Prefer narrow, tree-shakeable imports over broad
  utility barrels or dependencies that pull unrelated runtime surfaces into the client.
- Do not duplicate a type, schema, helper, or implementation to avoid respecting its owning
  package boundary.

## Configuration Ownership

- Change configuration at its durable owning source. Treat generated configuration as output, not
  as the place for persistent edits.
- Keep configuration defaults, schemas, persisted defaults, and user-facing configuration
  surfaces aligned with their owner.
- When ownership moves, update every consumer to use the new owner and remove the parallel source
  of truth.
- Handle incompatible persisted-schema changes through the owning migration or version mechanism,
  not scattered cleanup in consumers.
- Keep runtime-specific configuration in the runtime adapter instead of threading it through
  shared core as ambient state.

## Generated And Published Surfaces

- Do not patch generated files as the final implementation when an upstream source can produce the
  correct output.
- Keep public exports intentional and narrow; adding an export creates a supported package
  boundary.
- Verify changes from at least one external consumer boundary when modifying a published API.
