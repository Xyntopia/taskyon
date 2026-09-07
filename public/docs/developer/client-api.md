# Client and Protocol API

`createTaskyonClient(port)` exposes nested protocol services and convenience operations over a
Taskyon port. `initializeTaskyon(...)` creates that connection for an iframe host.

```ts
const result = await client.runTasks([[toolCall({ name: 'entryNode', arguments: {} })]], 'return', {
  timeoutMs: 60_000,
  show: true,
})
```

`runTasks` accepts task chains, a quit condition, and execution options. It returns the matched task
or throws on error, abort, or timeout. Use `processTasksDetailed(port)` when the caller needs the
settlement status and observed tasks.

Common execution options are:

- `timeoutMs` and `signal` for bounded execution;
- `display: 'activeChat' | 'background'` or the legacy `show` flag;
- `throwOnError: false` when the caller wants an error task as a normal settlement;
- `interruptOnSettle` when the host must stop remaining work after a match, timeout, abort, or
  error.

Quit conditions can be a task content type, an array of content types, or a predicate. Waiting for
`return` detects explicit workflow completion; waiting for `structured` is useful for typed data.

The client also exposes:

- `task`, `tools`, `files`, `archive`, and `peer` protocol services;
- `callTool(name, args, options)` for RPC tool execution;
- `sendFiles(files)` for file registration;
- `waitUntilReady(options)` for explicit startup coordination.

`tools.resolveInvocation({ name, toolRevision?, settingsRevision? })` returns the opaque immutable
revisions for one target. It does not return settings values. Sandboxed tools receive the same
narrow operation as `context.resolveInvocation(...)`.

Task creation compiles unhashed drafts into linked nodes with pinned invocation revisions before
persistence. The response contains those final IDs. Callers can also resolve every invocation
revision and use the shared hashing functions to submit completed, pre-hashed nodes; core verifies
their IDs and stores them unchanged. A chain must not mix drafts and completed nodes.

`createTaskChainFromMarkdown(client, markdown, options)` imports portable Taskyon Markdown and
returns the new leaf ID. Import does not execute by default.

## Tool RPC

`registerToolRpcTools(...)` registers host functions on a port. `callTool(name, args, options)`
invokes a registered tool without creating a task tree. Use task execution when the call should be
auditable as workflow state; use direct tool RPC for host control paths that are already recorded
elsewhere.

Remote calls support timeouts, abort signals, and function cancellation. A host-provided
`createContext` supplies only the task-chain and other capabilities needed by that client tool.

## Readiness

Clients defer commands until Taskyon emits its ready lifecycle event or answers `peer.ping`.
`createTaskyonClient(port, { deferUntilReady: false })` disables that gate only when the caller
already owns startup ordering.

## Iframe client

`initializeTaskyon(...)` finds the configured iframe, transfers a message channel, sends partial
profile configuration, registers host tools, and returns a `TyClient`. Reconfiguration can change
the profile, persistence, binding key, and tool set without giving Taskyon ambient access to the
host page.

Use exports from `@taskyon/taskyon/api` and `@taskyon/tyclient`. Internal relative imports are not a
supported integration contract.

## Storage client

Hosts create a scoped storage capability with `createStorageClient`:

```ts
const storage = createStorageClient(port, {
  namespacePrefix: 'taskyon',
  distribution: 'local-only',
})

await storage.set({
  namespace: 'projects',
  id: 'active',
  value: project,
})

const current = await storage.get({
  namespace: 'projects',
  id: 'active',
})

const result = await storage.setIfUnchanged({
  namespace: 'projects',
  id: 'active',
  expectedContentHash: current.contentHash,
  value: nextProject,
})
```

Consumers provide logical namespaces and keys only. They must not prepend host or application
prefixes or choose a physical backend. `namespacePrefix` is a client-side namespace boundary, not
a user, device, session, or Space identity. Create a separate client when code needs a different
namespace prefix or distribution policy.

`get` returns the decoded logical value and its logical `contentHash`. Pass that hash to
`setIfUnchanged` to update a mutable record only if it has not changed since the read; pass `null`
when the record must not exist. The result reports `written` and the current logical content hash.
This is compare-and-set behavior for refs and other mutable heads, not a comparison of collections.

The provider performs the final atomic comparison with the stored representation's content hash.
The client translates between logical and stored hashes, so callers do not send a potentially
large expected value and a future encrypted codec can randomize stored bytes without changing the
domain API or requiring a separate revision-token record.

The built-in codec is trusted-local plaintext. It cannot create a `remote-allowed` client. Record
codecs encode and decode records on the trusted client side and may also support client-side
indexes over decoded data. A codec that supports protected remote storage must be injected by the
trusted host; encrypted Space storage and key lifecycle are not part of the current implementation.

# Client task projections

`client.taskModel` is a session-scoped, in-memory read model populated by task-creation events and
an injected read-only task source over the existing storage protocol.
`lineage(id)` and `selection(id)` return currently cached tasks synchronously; `loadLineage(id)`
and `discover(id)` progressively acquire missing data. `loadResults(callId, selectedId)` hydrates
raw result data on demand. `exportSelection(id)` requires the complete selected conversation
version and its subtask branches and fails if required contents are unavailable.

The client model and TaskManager reuse the same lineage walker, relationship-index helpers,
and verified content hydrator. Each owns its own cache and loading lifecycle. The walker works
with both synchronous cached reads and asynchronous storage reads; it does not choose which
results belong in a conversation. Client display selection and core execution-result resolution
remain separate responsibilities. The storage reader deliberately does not cache hydrated
content, so a complete export can verify current storage rather than a previous cached value.

At the runtime composition boundary, supply
`createTaskRecordReader(storageClient, storageSessionId)` as the `taskSource` option to
`createTaskyonClient`, or call `client.setTaskSource(reader)` when the active storage scope becomes
known. Replacing the source clears the client caches and invalidates pending imports. The reader
uses existing storage `get`, `getMany`, and `find` operations, validates task records and content
hashes, and exposes no writes. It adds no task-protocol command or event. Grant the underlying
storage capability only the operations and namespaces needed; this adapter is not an authorization
boundary or a cross-peer synchronization implementation.

The browser core runtime wires the reader when creating each session's storage. The worker-host
runtime wires it when `storageSessionId` is explicitly supplied. A plain task-only client can load
lineage with existing `task.get`, but reports unavailable record storage when asked to discover
subtasks or export a complete conversation; it must not silently fall back to remote traversal.

Keep a client model scoped to its owning session; clear it on session changes and dispose the
client when its port is retired. Known active selections are retained while subscribed views use
them; inactive records are evicted above the cache target. Completion describes the current
provider's enumerated records, not global knowledge across a distributed network.
Full exports re-enumerate child records and re-read selected task contents; cached tasks alone
cannot prove that storage still contains a complete selection. Live cross-client deletion
invalidation is not provided by a new task event.

The existing storage `find` returns all matching records, without cursor pagination. This change
does not introduce a paginated wire contract or claim bounded provider work. Efficient bounded
storage enumeration and cross-peer change synchronization remain separate work.
