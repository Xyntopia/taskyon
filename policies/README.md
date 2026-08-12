# Agent Policy Index

These files contain stable development policies and guardrails for AI agents and contributors.
They describe how to make decisions, not the current feature set, package inventory, command list,
or implementation status.

`AGENTS.md` is the routing layer. Read only the policies relevant to the requested work, plus any
nearer package-level `AGENTS.md`.

| Policy                                                                  | Read when                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Tools and workflows](tools-and-workflows.md)                           | Creating or changing Taskyon tools or task workflows                         |
| [Protocols and runtime boundaries](protocols-and-runtime-boundaries.md) | Crossing process, UI, peer, browser, or Node boundaries                      |
| [Local-first storage and security](local-first-storage-and-security.md) | Handling persistence, files, secrets, caches, remote storage, or P2P sharing |
| [Testing and diagnostics](testing-and-diagnostics.md)                   | Adding behavior, tests, diagnostics, or verification                         |
| [Design graph execution](design-graph-execution.md)                     | Changing DAG execution, stored nodes, patches, studies, or optimization      |
| [Dependency policy](dependency-policy.md)                               | Adding, replacing, or widening a dependency                                  |
| [Package and configuration](package-and-configuration.md)               | Changing package boundaries, exports, generated config, or persisted schemas |
| [Repository workflow](repository-workflow.md)                           | Changing Git state, branches, commits, merges, or nested repositories        |
| [Frontend](frontend.md)                                                 | Changing Vue, UI state, styling, or user interaction                         |
| [`tycli` development](tycli-development.md)                             | Implementing, debugging, or evaluating `tycli`                               |
| [Modelica development](modelica-development.md)                         | Changing Modelica compilation, templates, runtimes, libraries, or simulation |
| [Rumoca development](rumoca-development.md)                             | Changing Rumoca source, semantics, tests, packaging, or its pinned revision  |

General programming guidelines that apply to every change live directly in `AGENTS.md`. When a
specialized policy and current software documentation disagree about behavior or commands, inspect
the code and configuration for current facts while continuing to follow the policy's decision
guardrails.

Forward-looking architecture proposals are maintained outside this repository. Taskyon does not
prescribe a parent project, deployment repository, or proposal path. Before creating or editing a
proposal, agents must ask the maintainer which external repository and path should own it. Proposals
do not document implemented behavior; keep implementation-status and user-facing claims in
`public/docs` grounded in current source and diagnostics.
