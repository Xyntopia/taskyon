# Protocols And Runtime Boundaries Policy

Apply this policy to MessagePorts, FRP protocols, iframe or UI boundaries, browser/Node splits,
client APIs, P2P services, and remote tool execution.

## Ports Own Cross-Boundary Communication

- Cross process, iframe, UI/core, client/host, worker, and peer boundaries through typed
  MessagePort/FRP protocols.
- Do not expose a generic event bus, parent-window access, raw internal object, or broad RPC bridge
  when a capability-scoped protocol can express the contract.
- Keep protocol schemas as the wire source of truth and validate dynamic messages at that boundary.
- Pass dependencies explicitly into protocol handlers instead of capturing hidden module state.

## Service Ownership

- Author peer protocols as service-scoped subprotocols with local command names.
- Let the protocol composition layer create flat wire names and let generated clients expose nested
  service APIs.
- Do not hand-prefix each command with its service name.
- Separate public, host/admin, storage, and individual tool capabilities structurally. Do not use a
  generic privilege flag.
- Keep routing and firewall decisions explicit when a protocol crosses local, remote, trusted, or
  untrusted boundaries.

## Runtime Portability

- Shared core code must remain usable in browser and Node runtimes.
- Runtime-specific capabilities belong in host adapters and are optional when unavailable.
- Do not fix one runtime by importing its filesystem, process, browser, or UI APIs into a shared
  module.
- Use the same protocol semantics and diagnostics across runtimes; differences should be modeled
  at registration or transport boundaries.

## Network Direction

- Prefer interoperable Taskyon protocols over centralized-service lock-in.
- Treat peers as capability providers and consumers rather than hard-coded client/server roles.
- Keep Taskyon's protocol family independent of a specific P2P transport.
- P2P, cloud, local IPC, and object-store gateways should adapt the same owned service contracts
  instead of introducing parallel application models.
- Never make fastest-response-wins the correctness rule for mutable or authoritative data.
