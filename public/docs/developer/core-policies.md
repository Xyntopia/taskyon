# Core Policies

These principles guide Taskyon design and development. They are intentionally short and listed in
descending order of importance. When principles conflict, the earlier principle takes precedence.

- **Local first.** Normal workflows work locally; remote services extend them.
- **Everything meaningful is a tool.** Agent-facing capabilities are composable tools; internal
  implementation details remain typed functions.
- **Deterministic when known.** Put stable parsing, validation, calculation, and workflow rules in
  executable code. Use models for judgment that cannot be expressed correctly as deterministic
  behavior, and keep those calls explicit.
- **Ports are power.** Runtime, service, and ownership boundaries use typed, capability-scoped
  protocols even when both sides are local; clients remain independent of where a service runs.
- **Protocols are scarce.** Every protocol capability may cross a future peer boundary. Keep wire
  contracts focused on intentional remote capabilities and canonical data; derive navigation,
  search, aggregation, and acceleration locally from cached or indexed state.
- **P2P, not lock-in.** Peers provide Taskyon services through shared contracts that are independent
  of transport.
- **Secure by default.** Use Taskyon's owned encryption, identity, secret, and permission
  boundaries.
- **Diagnostics are part of the product.** New behavior includes focused, executable diagnostics.
- **Reproducible task trees.** Record explicit inputs, observations, results, and workflow
  decisions so task execution can be inspected, audited, and reconstructed.
- **Demand-driven design graphs.** Evaluate a design-graph dependency only when a node explicitly
  requests it; storage and sandbox adapters preserve the same lazy semantics.
- **One source of truth.** Do not duplicate schemas, configuration, state, or behavior.
- **Root cause first.** Fix values and contracts at their owner, not symptoms downstream.
- **Consistency over novelty.** Extend established patterns unless they are demonstrably wrong.
- **Functions over classes.** Prefer pure functions, composition, explicit dependencies, and
  isolated side effects.
- **Dependencies must earn their cost.** Own simple logic; use proven libraries when correctness
  risk justifies them.

The repository's specialized policy files turn these principles into concrete guardrails for
tools, protocols, storage, testing, dependencies, packages, UI work, and individual runtimes.
