# Local-First Storage And Security Policy

Apply this policy to records, files, caches, projects, secrets, encryption, remote storage, P2P
sharing, and persistence.

## Local First

- Design normal workflows to work locally and continue through temporary network loss.
- Synchronization, cloud services, P2P reuse, and remote caches are optional capabilities layered
  over a useful local path.
- Read through the selected local store or index first. Verify and import remote data locally
  before normal consumption.
- Keep local indexes and derived caches rebuildable from durable records or artifacts.

## Storage Ownership

- Access storage through the owning typed storage client or repository boundary.
- Do not expose raw global OPFS, filesystem, database, or object-store access to core code or tools.
- Scope storage by project, workspace, conversation, tool, artifact, or another explicit domain
  namespace.
- Keep authoritative records, large blobs, derived indexes, configuration, and secrets distinct
  even when one backend stores several of them.
- Treat manifests as acceleration and discovery structures, not the only recoverable source of
  truth where object scanning is possible.

## Security By Default

- Use Taskyon's owned encryption, secret, identity, and permission boundaries instead of ad-hoc
  replacements.
- Give callers the least capability needed for the operation.
- Encrypt sensitive data before it reaches untrusted storage or peers.
- Authenticate encrypted data and verify content hashes, signatures, schemas, sizes, and namespace
  policy when importing remote objects.
- Do not describe encryption at rest as protection against a compromised runtime, privileged host,
  or approved tool that deliberately exports a secret.

## Sharing And Remote Caches

- Remote publication is opt-in for private tasks, files, documentation, and computation results.
- Content addressing proves byte identity, not correctness, authorization, or confidentiality.
- Treat cache-key-to-artifact claims separately from artifact transfer and require an explicit
  trust policy.
- Any peer may provide bytes once the expected content hash is known; reject invalid bytes before
  local import.
- Avoid equality, access-pattern, path, and size leakage where the threat model requires
  encryption, opaque names, padding, or capability-scoped discovery.
- Replication, pinning, expiry, and garbage collection are explicit durability policies. Sharding
  alone is not durability.

## Secrets

- Secrets use a dedicated, scoped API even when their encrypted records share a general storage
  backend.
- Do not place secrets, provider credentials, or recovery material in ordinary task results,
  reusable DAG artifacts, logs, or public caches.
- Remote services and tools that receive a secret remain trusted data recipients and must be
  presented as such.
