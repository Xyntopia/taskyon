# Core Policies

These principles guide Taskyon design and development. They are intentionally short and listed in
descending order of importance. When principles conflict, the earlier principle takes precedence.

- **Local first.** Normal workflows work locally; remote services extend them.
- **Everything meaningful is a tool.** Agent-facing capabilities are composable tools; internal
  implementation details remain typed functions.
- **Ports are power.** Runtime and trust boundaries use typed, capability-scoped protocols.
- **P2P, not lock-in.** Peers provide Taskyon services through shared contracts that are independent
  of transport.
- **Secure by default.** Use Taskyon's owned encryption, identity, secret, and permission
  boundaries.
- **Diagnostics are part of the product.** New behavior includes focused, executable diagnostics.
- **Reproducible task trees.** Record explicit inputs, observations, results, and workflow
  decisions so task execution can be inspected, audited, and reconstructed.
- **One source of truth.** Do not duplicate schemas, configuration, state, or behavior.
- **Root cause first.** Fix values and contracts at their owner, not symptoms downstream.
- **Consistency over novelty.** Extend established patterns unless they are demonstrably wrong.
- **Functions over classes.** Prefer pure functions, composition, explicit dependencies, and
  isolated side effects.
- **Dependencies must earn their cost.** Own simple logic; use proven libraries when correctness
  risk justifies them.

The repository's specialized policy files turn these principles into concrete guardrails for
tools, protocols, storage, testing, dependencies, packages, UI work, and individual runtimes.
