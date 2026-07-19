# Design Proposals

These documents describe active architectural direction. They are not user documentation or a
promise that every described capability is implemented.

| Document                                                             | Status   | Implementation authority                   |
| -------------------------------------------------------------------- | -------- | ------------------------------------------ |
| [Sandboxed core and protocol](/md/proposals/sandboxed-core-protocol) | accepted | `packages/taskyon/src/api/`                |
| [Runtime storage](/md/proposals/runtime-storage)                     | proposal | storage protocols and host services        |
| [Encrypted storage objects](/md/proposals/encrypted-storage)         | proposal | storage and crypto implementations         |
| [P2P network](/md/proposals/p2p-network)                             | proposal | `packages/p2p-core/` and Taskyon P2P hosts |
| [P2P DAG cache](/md/proposals/p2p-dag-cache)                         | proposal | comp-dag storage and P2P cache services    |

When implementation and a design note disagree, current code and diagnostics are authoritative.
Update the note when the implementation deliberately changes its boundary.
