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
- Synchronize portable derived indexes through ordinary encrypted record/blob capabilities when a
  Space explicitly opts in. Do not add index-specific storage commands or let a replicated index
  become authoritative; plaintext remote query execution is a separate trusted service capability.
- A derived operation belongs on a protocol only when remote execution is the intended service,
  not merely an implementation shortcut. Document its trust, authorization, and data-exposure
  boundary.
- Treat IDs returned by task creation responses as authoritative. Persistence may resolve tool
  revisions, apply settings, deduplicate definitions, or otherwise normalize drafts before hashing;
  clients must not navigate to or publish locally predicted draft IDs.

## Service Ownership

- Author peer protocols as service-scoped subprotocols with local command names.
- Let the protocol composition layer create flat wire names and let generated clients expose nested
  service APIs.
- Do not hand-prefix each command with its service name.
- Separate public, host/admin, storage, and individual tool capabilities structurally. Do not use a
  generic privilege flag.
- Describe supported peer protocols and tools through canonical API documents. Advertise reachable
  service instances separately with a signer, protocol/version, API-description revision, limits,
  routing information, and expiry.
- Treat a service advertisement as descriptive only. Require a separate capability grant for the
  allowed principal, space, operations, namespaces, quotas, and delegation behavior.
- Keep device-control protocols separate from space participation and data-service protocols. A
  space may administer a device only through a device-authorized control grant; ordinary membership
  or service publication cannot create that authority.
- Keep routing and firewall decisions explicit when a protocol crosses local, remote, trusted, or
  untrusted boundaries.

## Enrollment And External Networks

- Model device enrollment as an explicit request, out-of-band identity verification, owner
  approval, device-control grant, and separate space-membership grants. Local discovery, QR codes,
  short codes, links, and SSH bootstrap are alternative ceremonies for that same state transition.
- Make enrollment invitations short-lived, single-use, and narrowly scoped. Never place reusable
  space secrets, root keys, or administrator credentials in discovery announcements, command-line
  arguments, shell history, QR codes, or logs.
- Let SSH bootstrap install or start the agent and submit an enrollment request; it must not
  silently admit the device or create administrative authority.
- Integrate external collaboration systems such as Matrix through adapters. Preserve their native
  identity, membership, encryption, event, and unknown-data semantics rather than rebuilding them
  as Taskyon protocols.
- Keep Taskyon authorization authoritative for Taskyon data and services. External room membership
  may create a pending membership proposal but must not silently grant storage, graph, worker,
  secret, or device-control capabilities.

## Storage Key Ownership

- Storage protocols transport namespaces, keys, records, and blobs without interpreting domain
  identity or exposing filesystem paths.
- Apply logical scope, distribution policy, codecs, and logical-to-stored hash translation in the
  trusted StorageClient before crossing the protocol port. The storage service authorizes and
  persists the resulting stored representation; it must not own client encryption authority.
- Bind distribution policy to a constructed client capability. Do not let ordinary domain calls
  alternate between local and remote eligibility on individual operations.
- Untrusted-provider adapters receive opaque scoped identifiers and authenticated ciphertext, not
  caller-visible namespace names, Space identifiers, plaintext metadata, or decryption keys.
- The owning service calculates canonical task, node, computation, or content hashes when those
  hashes define identity. Storage backends only map supplied keys to local database, object-store,
  filesystem, or peer operations.
- Keep backend sharding and temporary streaming paths private. Peers exchange logical hashes and
  verified bytes, never host-specific paths.
- Keep generic paginated catalog enumeration at the storage boundary when recovery or
  administration requires it. Return opaque object identifiers and storage metadata; Space
  recognition, manifest decryption, history reconstruction, and domain filtering remain local
  client behavior rather than `recoverSpace` or project-specific protocol commands.
- Model mirror or repair access separately from plaintext read access. A provider that can locate,
  retrieve, verify, and replicate ciphertext must not thereby gain a decryption, mutation,
  delegation, Space-administration, or device-control capability.
- Advance encrypted mutable heads through conditional writes with signed sequence and key-epoch
  validation. Never resolve competing provider responses by latency or provider preference.

## Runtime Portability

- Shared core code must remain usable in browser and Node runtimes.
- Runtime-specific capabilities belong in host adapters and are optional when unavailable.
- Do not fix one runtime by importing its filesystem, process, browser, or UI APIs into a shared
  module.
- Use the same protocol semantics and diagnostics across runtimes; differences should be modeled
  at registration or transport boundaries.
- Preserve lazy invocation execution across worker/process boundaries with bounded row events,
  cancellation, and backpressure. Do not serialize a complete study array merely because execution
  crosses a protocol; persist bulk rows through the shared blob capability and exchange typed
  progress and artifact references.

## Network Direction

- Prefer interoperable Taskyon protocols over centralized-service lock-in.
- Treat peers as capability providers and consumers rather than hard-coded client/server roles.
- Keep Taskyon's protocol family independent of a specific P2P transport.
- P2P, cloud, local IPC, and object-store gateways should adapt the same owned service contracts
  instead of introducing parallel application models.
- Separate the global connectivity fabric from private Space overlays. Global discovery may reveal
  peer identities, relays, transports, and generic protocol support, but never Space membership or
  Space-private service details.
- Authenticate and encrypt Space traffic independently from its transport. Multiple overlays may
  multiplex one connection by default; support dedicated connections and member-only or blind
  relays when a Space policy requires stronger traffic separation.
- Never make fastest-response-wins the correctness rule for mutable or authoritative data.
