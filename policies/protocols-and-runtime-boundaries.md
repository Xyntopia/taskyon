# Protocols And Runtime Boundaries Policy

Apply this policy to MessagePorts, FRP protocols, iframe or UI boundaries, browser/Node splits,
client APIs, P2P services, and remote tool execution.

## Ports Own Cross-Boundary Communication

- Cross process, iframe, UI/core, client/host, worker, and peer boundaries through typed
  MessagePort/FRP protocols.
- Also use protocols at meaningful service and ownership boundaries when both sides currently run
  in-process. Local placement does not justify coupling a consumer to a concrete implementation.
- Do not expose a generic event bus, parent-window access, raw internal object, or broad RPC bridge
  when a capability-scoped protocol can express the contract.
- Keep protocol schemas as the wire source of truth and validate dynamic messages at that boundary.
- Pass dependencies explicitly into protocol handlers instead of capturing hidden module state.

## Location Transparency And Decoupling

- A protocol client must use the same capability contract whether its provider is local, in a
  worker, in another process, or available through a peer transport.
- Choose the provider, transport, and adapter at an explicit composition boundary. Do not spread
  local-versus-remote branches, backend checks, or transport knowledge through consumers.
- Use protocols to separate meaningful ownership, lifecycle, runtime, trust, and replaceability
  boundaries. This keeps clients small and allows implementations to move without rewriting them.
- Do not replace direct function composition inside one cohesive implementation with protocol
  calls. Protocols structure boundaries; they are not a default abstraction for every function.

## Keep The Wire Surface Small

- Treat every protocol command as potentially reachable through a future peer transport, even when
  its first consumer uses an in-process or local MessagePort.
- Protocol scarcity applies to the command surface, not to the number of local or remote adapters
  implementing the same contract.
- Put canonical data exchange and deliberately remote capabilities on protocols. Keep derived
  graph navigation, filtering, ranking, aggregation, and acceleration in local functions, caches,
  or rebuildable indexes.
- Do not add a remote convenience query when a consumer can derive the answer from canonical
  records it already holds.
- When records are missing, prefer fetching or synchronizing the smallest canonical records needed
  for local derivation instead of widening the protocol with each new query shape.
- A derived operation belongs on a protocol only when remote execution is the intended service,
  not merely an implementation shortcut. Document its trust, authorization, and data-exposure
  boundary.

## Service Ownership

- Author peer protocols as service-scoped subprotocols with local command names.
- Let the protocol composition layer create flat wire names and let generated clients expose nested
  service APIs.
- Do not hand-prefix each command with its service name.
- Separate public, host/admin, storage, and individual tool capabilities structurally. Do not use a
  generic privilege flag.
- Keep routing and firewall decisions explicit when a protocol crosses local, remote, trusted, or
  untrusted boundaries.

## Storage Key Ownership

- Storage protocols transport namespaces, keys, records, and blobs without interpreting domain
  identity or exposing filesystem paths.
- The owning service calculates canonical task, node, computation, or content hashes when those
  hashes define identity. Storage backends only map supplied keys to local database, object-store,
  filesystem, or peer operations.
- Keep backend sharding and temporary streaming paths private. Peers exchange logical hashes and
  verified bytes, never host-specific paths.

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
