# Taskyon Runtime Storage Concept

## Purpose

Taskyon needs one coherent storage model that works across browser, CLI, local
apps, servers, cloud backends, and P2P peers. The goal is not to force every
kind of data into one database. The goal is to give Taskyon core and tools one
simple storage protocol, with configurable backends and gateways behind it.

This should reduce direct dependencies on PGlite, OPFS, Node filesystem paths,
browser-only APIs, and ad-hoc tool-local storage.

This document describes the runtime service model. The concrete encrypted object
format, chunking policy, manifest repair strategy, and lazy lookup flow are
specified in `taskyon_encrypted_storage_objects.md`.

## Short Proposal

Taskyon should move durable runtime storage behind one scoped storage client.
The immediate reason is practical: multiple Taskyon or `tycli` processes should
be able to run at the same time without fighting over one persistent PGlite
database. Running separate PGlite databases avoids locking, but then tasks,
artifacts, and tool data do not synchronize.

The proposed direction is:

- Treat storage as a service capability announced inside a Taskyon subnetwork.
- Back storage services with process-safe records and blobs under Taskyon
  runtime roots, OPFS, encrypted databases, cloud stores, Syncthing bridges, or
  other adapters.
- Keep PGlite for local indexes, vector search, documentation indexes, and
  rebuildable caches.
- Expose storage through a shared `StorageClient` and FRP/port protocol, so
  browser, CLI, lightweight clients, workers, tools, servers, cloud backends,
  and P2P gateways use the same boundary.
- Treat manifests as encrypted indexes for fast lookup, not as the only source
  of truth.
- Store enough encrypted metadata inside each durable object that manifests can
  be rebuilt by scanning available objects with the correct key.
- Add P2P as a sync/import gateway over the same storage protocol instead of
  making P2P a separate storage API.
- Store durable records and blobs as encrypted storage objects with bucketed
  chunking, repairable manifests, and deterministic HMAC object names as
  described in `taskyon_encrypted_storage_objects.md`.

This means a storage service should be the first durable replacement for
persistent PGlite. A local file/object store is the simplest backend for that
service. P2P is the idiomatic long-term discovery, routing, and sync layer for
Taskyon, but it should move storage protocol messages and encrypted storage
objects instead of becoming a separate storage model.

## Requirements

- Browser and CLI should use the same core/tool code where possible.
- CLI storage must be rooted in predictable Taskyon directories, not scattered
  through the repo, current working directory, or arbitrary temp paths.
- Multiple Taskyon or `tycli` processes should be able to use the same storage
  service without corrupting data or losing task/artifact synchronization.
- Browser storage should map naturally to origin-scoped OPFS/IndexedDB.
- Tools are app-like and need sandboxed storage.
- Tools also need explicit shared storage for exchanging artifacts and records.
- Taskyon should support untrusted remote/cloud/P2P storage.
- Data should be encryptable client-side before reaching untrusted backends.
- Secrets are encrypted records with stricter access rules, not a special
  backend-only concept.
- PGlite should remain useful for local indexes, vector search, and cache-like
  data, but should not be the long-term durable source of truth for shared
  multi-process storage.
- Indexes should usually be local and rebuildable.
- Files/blobs should support chunking before encryption for privacy and safer
  untrusted storage. For large blobs this also makes uploads, P2P transfer, and
  reuse practical.
- DAG node results should be reusable across peers when possible.
- P2P should work as a local-first sync/import layer, not as nondeterministic
  "whoever answers first" storage.
- FRP/ports should be used for transport, events, filtering, and gateways.
- Storage operations themselves should remain explicit request/response calls.
- Lightweight clients and transient workers should be able to run with only a
  small local cache and use storage services announced by the subnetwork.
- Durable storage should be recoverable from encrypted object contents where a
  backend can list objects; manifests should speed lookup, not become the only
  recovery path.

## Core Idea

Taskyon should expose a small runtime storage protocol built around namespaces,
records, blobs, local indexes, service announcements, and gateways.

Core and tools should not directly know whether storage is backed by OPFS,
files, memory, PGlite, cloud, or P2P. They should call a scoped storage client.

```text
core/tool code
  -> scoped storage client
  -> policy/transform layers
       - schema validation
       - compression
       - encryption/signing
       - content addressing
       - chunking
  -> storage protocol over ports/FRP
  -> storage service
  -> backend adapter
```

The storage service is the stable concept. Local files, OPFS, encrypted remote
objects, Syncthing folders, cloud buckets, and PGlite indexes are backend
choices behind that service.

## Subnetwork Storage Services

A Taskyon subnetwork is a logical entity made of peers that announce services.
Storage is one such service. A peer can be a browser tab, CLI process, headless
worker, sandbox, server, gateway, or durable storage process.

Examples:

```text
organization subnetwork
  browser UI peer       -> announces UI capability over taskyonProtocol
  lightweight tycli     -> announces client capability, cache only
  worker peer           -> announces tool/execution capability
  bash tool peer        -> announces one privileged tool capability
  disk storage peer     -> announces durable storage capability
  OPFS browser peer     -> announces browser-local storage capability
  gateway peer          -> announces bridge to another subnetwork/cloud
  index peer            -> announces vector/full-text index capability
```

Peers announce capabilities. The rest of the subnetwork uses those capabilities
through FRP protocols, regardless of whether peers are on the same machine or on
opposite sides of the world.

Individual tools can be announced as their own services. A peer can expose a
single `bash`/CLI tool, compiler, converter, or documentation lookup service
without becoming a general worker. Tool services should keep their own storage
scope and should be routed through the same firewall/capability checks as other
network services.

UI surfaces can also be announced as services. A browser UI, CLI, dashboard, or
embedded Taskyon view should increasingly interact through `taskyonProtocol` and
related FRP streams, so UI placement becomes a routing/transport choice instead
of a separate integration model.

Storage service announcements should describe at least:

```text
service type       storage
protocol           taskyon.storage.v1
namespaces         tasks/*, dag/*, artifacts/*
mode               durable, cache, archive, mirror, read-only
trust              local, trusted-member, untrusted-encrypted
availability       persistent, best-effort, transient
encryption         none, local, client-side-required
transport hints    local stream, websocket, libp2p stream, relay
```

For v1, routing should stay deterministic:

```text
one selected durable storage service per namespace
optional cache services
optional mirror/archive services
```

Avoid a model where any storage service can answer any read and the fastest
response wins. That would make task state and artifact ownership hard to audit.

## Storage Roots

Taskyon should expose only a small set of logical roots:

```ts
type StorageClass = 'config' | 'durable' | 'cache'
```

The runtime maps those to platform paths.

Browser:

```text
config  -> origin-scoped IndexedDB/OPFS namespace
durable -> origin-scoped OPFS/IndexedDB namespace
cache   -> origin-scoped OPFS/IndexedDB cache namespace
```

CLI:

```text
config  -> ~/.config/tycli
durable -> ~/.local/share/tycli
cache   -> ~/.cache/tycli
```

Core and tools should not construct those paths. They should use runtime storage
services.

## Data Model

Use a few primitive storage concepts:

### Records

Structured JSON-like values. Examples:

- task nodes
- DAG nodes
- tool settings
- tool records
- workspace records
- manifests
- encrypted secret records

Records live in namespaces:

```text
task/<taskId>
dag/<dagNodeHash>
tool/<toolId>/records/<id>
workspace/<workspaceId>/records/<id>
conversation/<conversationId>/records/<id>
secret/<scope>/<name>
```

### Blobs

Large binary or text payloads. Examples:

- uploaded files
- generated artifacts
- large tool results
- model outputs
- serialized DAG node payloads
- encrypted remote payloads

Blobs should be content-addressed where possible.

### Chunked Blobs

Blobs should be split into chunks plus a manifest. This is useful for large
files, but it is not only a large-file feature. Chunking before encryption also
reduces size leakage, makes opaque storage safer, and improves P2P transfer.

```text
blob manifest
  -> chunk ref
  -> chunk ref
  -> chunk ref
```

Each chunk should be encrypted independently. With fixed-size or padded chunk
buckets, remote stores and peers learn less about the original file size and
structure.

The tradeoff is manifest complexity. Chunk size, padding policy, ordering,
integrity checks, and reassembly metadata must be handled carefully. The default
should prefer privacy and correctness over maximum deduplication, because
deduplication across encrypted users/devices can leak equality information.

A streaming API can come later; the data model should support chunking from the
start.

Chunk size selection should use bucketed policies rather than exact file-size
chunks. The detailed object-level proposal is in
`taskyon_encrypted_storage_objects.md`; the runtime storage layer should only
depend on the resulting blob refs and manifests.

### Manifests And Repair

Manifests are indexes. They should make common operations fast:

- root discovery
- directory listing
- latest-version lookup
- chunk ordering

They should not be the only source of truth. Durable encrypted objects should be
self-describing enough that a client with the correct key can scan available
objects and rebuild missing or stale manifests.

Each encrypted durable object should include authenticated metadata such as:

- namespace
- object kind
- real path and filename, when applicable
- version id
- chunk index and count
- chunk policy
- plaintext size
- content hash

Recovery should work like this:

```text
list opaque backend objects
  -> try decrypt objects with available keys
  -> read encrypted metadata
  -> group by namespace/path/version
  -> verify chunks and hashes
  -> rebuild file and directory manifests
```

This recovery path requires a backend that can list opaque objects. If a backend
cannot list objects, a known root anchor or external inventory is still needed.

### Local Indexes

Indexes are local acceleration structures. Examples:

- task graph indexes
- vector search
- documentation chunks
- DAG lookup indexes
- full text search

Indexes are not authoritative. They can be rebuilt from records and blobs.
PGlite is a good fit here.

## Storage Protocol

The public boundary should be a dedicated storage client, not raw `CrudWrapper`.

Initial shape:

```ts
type StorageClient = {
  records: {
    get(namespace: string, id: string): Promise<RecordEnvelope | null>
    put(namespace: string, id: string, record: RecordEnvelope): Promise<void>
    delete(namespace: string, id: string): Promise<void>
    list(namespace: string, query?: ListQuery): Promise<RecordRef[]>
    watch(namespace: string, query?: ListQuery): Stream<StorageEvent>
  }

  blobs: {
    put(data: Uint8Array, options?: PutBlobOptions): Promise<BlobRef>
    get(ref: BlobRef): Promise<Uint8Array>
    has(ref: BlobRef): Promise<boolean>
    delete(ref: BlobRef): Promise<void>
  }
}
```

Later, blob streaming can be added without changing the higher-level concept:

```ts
putStream(stream: AsyncIterable<Uint8Array>): Promise<BlobRef>
getStream(ref: BlobRef): AsyncIterable<Uint8Array>
```

## Envelopes

Backends should store envelopes, not necessarily decrypted application objects.

```ts
type RecordEnvelope = {
  namespace: string
  id: string
  contentType: string
  encoding: 'json' | 'bytes'
  encryption: 'none' | 'local' | 'e2e'
  payload: Uint8Array
  hash?: string
  signature?: string
  createdAt: number
}
```

Untrusted servers and peers can store encrypted envelopes or encrypted blob
chunks without understanding their contents.

## Encryption

Encryption should be a transform layer above untrusted storage and below the
tool/core API.

```text
tool/core
  -> scoped storage client
  -> encryption wrapper
  -> backend/protocol/gateway
```

This keeps encryption client-side for E2E use cases. The backend can be dumb
encrypted blob/record storage.

Secrets are just a stricter encrypted-record namespace with a dedicated API:

```ts
ctx.storage.secrets.get('apiKey')
ctx.storage.secrets.set('apiKey', value)
```

The secret backend should not be special. The access policy is special.

## Tool Storage

Tools should receive scoped storage. A tool should not get raw global storage.

```ts
type ToolStorageContext = {
  records: ScopedRecordStore
  files: ScopedFileStore
  cache: ScopedCacheStore
  secrets: ScopedSecretStore
  blobs: ScopedBlobStore
}
```

Tool namespaces:

```text
tool/<toolId>/records/*
tool/<toolId>/files/*
tool/<toolId>/cache/*
tool/<toolId>/secrets/*
```

Shared storage should be explicit:

```text
workspace/<workspaceId>/...
conversation/<conversationId>/...
artifact/<hash>
```

Avoid a single unrestricted global bucket. Shared storage needs ownership,
namespace, visibility, and sync policy.

## DAG Nodes

DAG nodes should not require a completely separate storage system. They can be
stored as records and/or blobs:

```text
records/dag/<nodeHash>
blobs/<payloadHash>
```

This is P2P-friendly. If one peer computed a DAG node, another peer can request
the record/blob, verify the hash/signature, import it locally, and reuse the
result.

DAG indexes should remain local and rebuildable.

## PGlite Role

PGlite should become a backend, not the storage model.

Good uses:

- local vector search
- local documentation index
- local task graph index
- local cache
- memory-backed CLI runtime indexes

Avoid using one persistent PGlite directory as the universal source of truth for
multiple CLI processes. PGlite has a single-owner style model and is not the
right abstraction for shared multi-process durable storage.

## CrudWrapper Role

`CrudWrapper` is still useful, but it should be an implementation helper.

Keep and evolve:

- memory CRUD wrapper
- file CRUD wrapper
- OPFS CRUD wrapper
- PGlite CRUD wrapper
- protocol-backed CRUD wrapper
- encryption wrapper
- cache/mirror wrapper
- live event wrapper

But the public runtime concept should be the storage client/protocol, not raw
CRUD. CRUD is table-shaped; Taskyon storage also needs namespaces, blobs,
chunking, encryption policy, capability checks, provenance, and gateways.

## FRP And Ports

Storage should have an FRP/port protocol similar to the existing Taskyon API.

Use FRP/ports for:

- storage RPC transport
- events
- subscriptions
- iframe parent/child boundaries
- UI/core boundaries
- P2P gateways
- cloud gateways
- filtering by namespace and capability

Do not use loose broadcast reads where any backend can answer and the fastest
response wins. Reads should be deterministic.

## P2P Model

P2P should act as a sync/import gateway.

Local storage remains authoritative for normal reads:

```text
read local index/store
if missing, request from peers/cloud
verify/import locally
then read locally
```

Peers should exchange:

- namespace manifests
- encrypted records
- encrypted blob chunks
- DAG node records/blobs
- artifact refs

Those exchanged objects should use the same encrypted storage object format as
local backends. P2P should not define a parallel task/blob format.

Gateways decide what crosses a boundary:

```text
private tool namespace -> local only
workspace namespace    -> selected subnet peers
artifact blobs         -> syncable
secrets                -> local/e2e only
indexes                -> local by default
```

The existing P2P requirements still apply: subnet membership by shared secret,
encrypted/authenticated messaging, low metadata leakage, resilience, and
transport-agnostic higher-level protocols.

## Backend Examples

Browser:

```text
records -> OPFS/IndexedDB
blobs   -> OPFS
indexes -> PGlite/IndexedDB/local memory
secrets -> encrypted records
```

CLI:

```text
records -> durable files under ~/.local/share/tycli
blobs   -> durable/chunked files under ~/.local/share/tycli
indexes -> cache PGlite under ~/.cache/tycli or memory
secrets -> encrypted config/durable records
```

P2P/cloud:

```text
records -> encrypted envelopes
blobs   -> encrypted chunks
indexes -> not authoritative, usually not synced
```

## Recommended Migration Path

1. Define `StorageClient` and envelope/ref types.
2. Add a local memory/file implementation for records and blobs.
3. Add an OPFS implementation for browser.
4. Add a protocol-backed implementation over FRP/ports.
5. Add scoped tool storage to tool context.
6. Move CLI durable storage to file/blob records.
7. Keep PGlite for local indexes and vectors.
8. Move task graph queries into typed repository helpers over storage/indexes.
9. Add chunked blob storage.
10. Add manifest repair by scanning local encrypted objects where possible.
11. Add P2P/cloud gateways that exchange encrypted records, blobs, and manifests.

## Summary

Taskyon should use one runtime storage protocol with scoped namespaces, records,
blobs, local indexes, encryption transforms, and FRP/port gateways.

Durable data is stored as records and blobs. Indexes are local and rebuildable.
Tools receive sandboxed storage. Shared storage is explicit. PGlite remains a
valuable local index/vector/cache backend, but not the universal source of truth.
P2P and cloud storage become gateways for encrypted manifests, records, blobs,
and reusable DAG node results.
