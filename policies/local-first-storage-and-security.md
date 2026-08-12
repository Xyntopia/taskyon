# Local-First Storage And Security Policy

Apply this policy to records, files, caches, projects, secrets, encryption, remote storage, P2P
sharing, and persistence.

## Local First

- Design normal workflows to work locally and continue through temporary network loss.
- Synchronization, cloud services, P2P reuse, and remote caches are optional capabilities layered
  over a useful local path.
- Read through the selected local store or index first. Verify and import remote data locally
  before normal consumption.
- Derive graph navigation, filtering, ranking, and other disposable views locally from canonical
  records. Use smart caches and indexes rather than specialized remote convenience queries.
- Keep local indexes and derived caches rebuildable from durable records or artifacts.
- Build indexes on the trusted client side after decrypting and validating their canonical source
  records. Keep canonical records sufficient to discard and rebuild every index.

## Storage Ownership

- Access storage through the owning typed storage client or repository boundary.
- Give consumers a scoped StorageClient capability at the composition boundary. Consumers use
  logical namespaces and keys; they must not prepend session, device, user, or space identifiers or
  choose physical providers themselves.
- Construct local and Space-scoped clients with explicit scope, codec, cache, provider-routing,
  placement, and replication dependencies. Do not switch a shared global client between Spaces or
  let consumers import Space state directly.
- Keep scoping, distribution selection, record encoding, logical/stored hash translation, and
  namespace validation on the trusted client side of the protocol port. A remote or blind storage
  service must never receive the codec, Space keys, or other client-side authority merely because
  it implements the storage protocol.
- Keep user identity, device identity, crypto unlock sessions, execution sessions, and spaces as
  separate concepts. Do not make one session identifier the universal storage scope.
- The StorageClient-backed design-graph repository is the authoritative working copy across the
  spaces currently authorized in Taskyon and Joulios browser and CLI runtimes. Repository consumers
  operate on exact logical file paths and text through one shared repository wrapper; space
  scoping, backend hashing, and sharding remain internal StorageClient concerns.
- Store global nodes and graph revisions, invocation definitions, project revisions and refs,
  namespaced project extensions, and invocation-run manifests in that
  repository. Projects select shared immutable objects; they do not create per-project node stores.
- While the application remains pre-release, schema changes are clean cutovers: clear incompatible
  local namespaces and rebuild bundled repositories instead of adding legacy readers or dual-write
  paths.
- Bind `local-only` or `remote-allowed` distribution policy when constructing a scoped
  StorageClient. Domain operations must not select distribution per request; a differently scoped
  or distributed capability is a different client. Default composition to `local-only`, and reject
  remote eligibility when the configured codec cannot protect stored data.
- `remote-allowed` grants permission for a separately configured synchronization or replication
  layer to handle the object. It does not itself publish, replicate, or weaken authorization,
  validation, encryption, or namespace policy.
- Allow a Space to synchronize an expensive derived index only as an explicitly selected encrypted
  acceleration artifact. Bind it to exact source roots, format/schema and derivation versions, and
  immutable segment hashes; use a small conditional-write head for mutable selection.
- Treat synchronized indexes as potentially more revealing than individual source records. Share
  only the minimum authorized source projection, never infer index publication from source-file
  sharing, and discard stale, incompatible, corrupt, or unauthorized indexes instead of treating
  them as authority.
- Persist personal UI settings, local working drafts, undo history, engine settings, workspace
  layouts, and widget presentation state as `local-only`. A workspace or sandboxed view becomes a
  shareable project definition only through an explicit save into a namespaced project extension.
- Persist application projects, settings, uploaded resources, and derived caches through that same
  boundary. Do not let a feature create its own OPFS or filesystem backend.
- Keep storage consumers independent of backend placement. Select local, worker, remote, or peer
  adapters at the composition boundary while preserving the same client contract and semantics.
- Do not expose raw global OPFS, filesystem, database, or object-store access to core code or tools.
- Scope storage by project, workspace, conversation, tool, artifact, or another explicit domain
  namespace.
- Keep authoritative records, large blobs, derived indexes, configuration, and secrets distinct
  even when one backend stores several of them.
- Treat an encrypted mutable head and root-manifest tree as fast lookup and checkpoint structures,
  not the sole recoverable evidence that Space objects exist. Where provider capabilities permit
  enumeration, keep immutable Space manifests discoverable through opaque client-verifiable
  evidence so an authorized client can rebuild state without the latest head.
- Keep provider catalog enumeration generic, opaque, capability-scoped, and paginated. Storage
  providers return object identifiers and storage metadata; they do not interpret Spaces, files,
  projects, graphs, or manifest contents.
- Use canonical hashes as logical keys when identity comes from immutable content or a computation.
  Keep the generic storage protocol independent of key semantics and physical layout.
- Keep domain content hashes distinct from hashes or revision tokens for stored encrypted
  envelopes. Randomized encryption may produce different stored hashes for identical plaintext.
  Preserve atomic conditional writes through the scoped client and exact stored-envelope identity;
  never introduce deterministic encryption merely to collapse the two identities.
- Let the scoped client translate a caller's expected logical content hash into the current stored
  representation's content hash before issuing an atomic provider write. Providers compare only
  stored-content hashes and must not calculate domain hashes or require a parallel revision-token
  record.
- Encode canonical SHA-256 identities as unpadded base64url with the `sha256:` prefix across Taskyon
  records, artifacts, tool revisions, and design-graph records. Do not introduce a second hex form.
- Store a task occurrence separately from its immutable content: the occurrence retains call-stack
  links and a `contentRef`, while the content store deduplicates identical `TaskContent` values.
  Hydrate only at boundaries that need the full content.
- Store filesystem records under fixed-length hash-only paths. Backends may shard hashes into
  prefix directories but must not expose serialized keys or domain names as final filenames.
- Present large immutable artifacts to consumers as whole content-addressed blobs. Streaming pieces
  have no public domain identity, while the storage coordinator may retain opaque physical chunks
  under a private encrypted descriptor for range reads, replication, and repair.
- Keep encrypted segmentation and reconstruction metadata for large blobs private to the storage
  coordinator. A Space manifest references one logical blob; consumers and domain repositories do
  not acquire a second chunk-addressing model.
- Keep invocation rows in one staged, streamable artifact with a separately named access index.
  The index accelerates range reads and is not another content-addressing or chunk-manifest layer.
- Index immutable invocation-run manifests by their full invocation hash. Backends may prefix-shard
  that hash internally, but callers use the shared repository API rather than physical paths.
- Keep small invocation-run manifests until explicit cleanup. Apply configurable artifact-retention
  limits through engine settings with optional project-local operational overrides; artifact
  eviction must not mutate immutable run records.
- Raw backend inspection belongs only in explicit host-administration diagnostics and should be
  read-only by default. Normal tools and feature UIs operate on logical namespaces and object IDs.

## Security By Default

- Use Taskyon's owned encryption, secret, identity, and permission boundaries instead of ad-hoc
  replacements.
- Treat the long-lived user-owned space as the encryption and sharing domain. A device identity may
  authenticate a participant or provider but must not independently unlock user data.
- Keep persisted user and space data, durable replicas, and local caches encrypted by default.
  Decrypt ordinary values only in an explicitly unlocked runtime and keep plaintext out of
  ordinary StorageClient persistence.
- Treat authenticated encryption as mandatory before bytes cross into a remote, peer, or otherwise
  untrusted provider. An explicitly trusted-local plaintext codec may exist during development,
  but it must be modeled as such and must be rejected for remotely eligible writes.
- Version encrypted record, blob, manifest, and streaming envelopes from their first persisted
  format. Bind object type, format version, logical scope, and integrity-relevant metadata as
  authenticated data rather than relying on provider paths.
- Keep unlock credentials, platform key handles, and device bootstrap material outside ordinary
  StorageClient records. Inject an unlocked Space cryptographic capability into the scoped client;
  never let providers or ordinary consumers receive raw Space keys.
- Allow locked devices and external providers to store, fetch, and replicate authenticated
  ciphertext without receiving the space's decryption authority.
- Separate mirror or repair, read, write, share, Space-administration, and device-control
  capabilities. Storage replication must require only ciphertext location and verification
  authority.
- Treat a plaintext-capable unattended worker as an explicitly trusted principal with narrow,
  revocable delegation. Do not infer decryption authority from device or space participation.
- Use bounded streaming authenticated encryption for large values. Object size alone is not an
  encryption exemption; plaintext scratch storage requires a separate trusted-worker policy.
- Give callers the least capability needed for the operation.
- Encrypt sensitive data before it reaches untrusted storage or peers.
- Authenticate encrypted data and verify content hashes, signatures, schemas, sizes, and namespace
  policy when importing remote objects.
- Do not describe encryption at rest as protection against a compromised runtime, privileged host,
  or approved tool that deliberately exports a secret.

## Sharing And Remote Caches

- Use one space model for the default personal space and collaborative spaces. Private is the
  default; missing membership, ACL, distribution, or publication policy never means public.
- Keep device administration separate from space membership. A device explicitly selects one or
  more administrator spaces; joining or providing a service to another space grants it no control
  over that device.
- Keep protocol support, signed service advertisement, authorization grants, and provider
  selection or replication policy distinct. A peer claiming a protocol neither proves correct
  behavior nor grants access to space data.
- Keep the global connectivity fabric unaware of Space membership. Exchange Space-specific service
  details and capabilities only through private encrypted overlays. Several overlays may multiplex
  one physical connection unless a privacy policy requires dedicated routing.
- Treat users, registered devices, unattended services, tools, and transient clients as distinct
  principals. Transient clients require a passkey, password plus TOTP, or an atomically consumed
  one-time recovery code; they retain no reusable unlocked key, and encrypted transient caching is
  disabled by default.
- Make replication, pinning, encrypted cache limits, eviction, expiry, and minimum durability
  explicit policies. Verify durability requirements before evicting the last known retained copy.
- Treat cache, durable, and archive providers as different retention promises over the same opaque
  object model. Opportunistic cache copies never satisfy durable replica targets.
- Let applications request logical range reads, prefetch, complete offline pins, and pin release.
  Only the scoped coordinator may translate those requests into physical chunk priorities and
  opaque retention leases.
- Use encrypted chunk replication as the initial durability mechanism. Erasure coding may be added
  through a later private descriptor version without changing the logical blob API.
- Let blind providers enforce independent opaque leases and let blind repair workers copy and
  verify ciphertext. Only an authorized Space coordinator determines whether every descriptor,
  envelope, and chunk required for a logical file is recoverable.
- Keep direct private files on the shortest manifest-to-revision path. Promote a file to live
  sharing by adding a capability and small signed mutable head that reuses the existing immutable
  payload; do not force every file through shared-head machinery.
- Separate read, content-write, metadata-write, share, and administration grants for shared files.
  Preserve concurrent signed branches, use signed tombstones for deletion, and do not promise
  revocation of plaintext already disclosed.
- Keep each Space's mount path local. Publisher path propagation is opt-in; receivers may follow it
  or retain a local path, and path collisions must preserve both objects safely.
- Git is an explicit projection and synchronization layer above the authoritative repository, not
  a StorageClient backend. A Git working tree may cache staging and history but is never the only
  local copy.
- Validate every imported file, content hash, revision closure, project ref, and expected-current
  ref before mutation. Write immutable objects first and advance refs last.
- Exclude secrets, personal widget/workspace state, drafts, undo history, engine settings, execution
  attempts, invocation runs, caches, result payloads, and result artifacts from Git graph snapshots.
  Include explicitly saved project extensions because they are definitions, not personal state.
- Store source manifests in Git with the expected content hash and a capability-safe retrieval
  recipe. Fetch through the owning capability and verify exact bytes before replay.

- Remote publication is opt-in for private tasks, files, documentation, and computation results.
- Content addressing proves byte identity, not correctness, authorization, or confidentiality.
- Treat cache-key-to-artifact claims separately from artifact transfer and require an explicit
  trust policy.
- Verify peer-provided immutable records and blobs against their expected content hash before local
  import. The local physical layout must not be part of the peer contract.
- Any peer may provide bytes once the expected content hash is known; reject invalid bytes before
  local import.
- Avoid equality, access-pattern, path, and size leakage where the threat model requires
  encryption, opaque names, padding, or capability-scoped discovery.
- Map logical namespaces and keys to opaque provider identifiers inside the scoped client. Never
  expose plaintext namespace or Space identifiers merely to simplify provider layout.
- Use a secret-derived opaque rendezvous only to locate authorized provider catalogs and encrypted
  Space heads. Normal reads follow the current encrypted manifest tree; disaster recovery scans
  provider catalogs locally using Space-derived discovery evidence and verifies candidate signed
  histories.
- Do not claim that a Space secret can recover unavailable bytes or discover providers without a
  bootstrap transport. Recovery requires the secret plus the configured rendezvous network or at
  least one authorized provider catalog.
- Replication, pinning, expiry, and garbage collection are explicit durability policies. Sharding
  alone is not durability.

## Secrets

- Secrets use a dedicated, scoped API even when their encrypted records share a general storage
  backend.
- Do not place secrets, provider credentials, or recovery material in ordinary task results,
  reusable DAG artifacts, logs, or public caches.
- Remote services and tools that receive a secret remain trusted data recipients and must be
  presented as such.
