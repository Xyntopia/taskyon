# Rumoca Development Policy

Apply this policy before changing Rumoca source, compiler phases, language semantics, tests, or
packaging.

## Repository Boundary

- Treat Rumoca as an independently versioned repository, not an ordinary root workspace folder.
- Do not edit an uninitialized submodule or replace its gitlink with generated files.
- Initialize or otherwise obtain the intended Rumoca checkout before making changes.
- Once available, read its nearest `AGENTS.md` and referenced specifications; those narrower rules
  are authoritative for Rumoca source.
- Run Git and verification operations from the Rumoca repository when they concern Rumoca history
  or owned files.

## Correctness

- Ground language and compiler changes in Rumoca's current specifications, parser/typechecker
  boundaries, generated output, and focused tests.
- Fix semantic behavior in the highest owning compiler phase.
- Keep Taskyon integration adapters separate from compiler semantics.
- Do not weaken a compiler test or broaden a type merely to make a root integration pass.

## Integration

- Root Taskyon changes may update the pinned Rumoca revision or an integration boundary only after
  the Rumoca-owned change is verified.
- Keep browser, native, and packaging behavior aligned where the integration supports them.
- Use current Rumoca documentation for exact commands and source layout; those facts may change
  without changing this repository-boundary policy.

## Taskyon Upgrade Verification

- Verify Rumoca dependency and pinned-revision upgrades through Taskyon's maintained Modelica
  comparison commands and the committed baselines under `packages/modelica/compare/`.
- Use the Taskyon comparison harness to report before/after compile, simulation, and trace metrics;
  do not substitute Rumoca's upstream MSL gate because it measures a different integration
  boundary.
- Do not provision or run Rumoca's Python binding workflows for a Taskyon integration upgrade
  unless the user explicitly includes Python API compatibility in scope.
- Follow `packages/modelica/README.md` for the current comparison commands and artifacts instead of
  duplicating those changing details in this policy.
