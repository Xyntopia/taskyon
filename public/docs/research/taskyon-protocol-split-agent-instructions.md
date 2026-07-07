# Taskyon Protocol Split: First Implementation Step

## Goal

Move Taskyon core access away from direct `tyCore()` return-object methods and toward
`taskyonProtocol` commands. Do this incrementally by removing entries from the
`createProxyApi(...)` lists in `packages/taskyon/packages/taskyon/src/core/init.ts`.

Do not build the long-lived sandbox service yet. The first goal is to make the current
in-process Taskyon app use the same protocol boundary that a later sandboxed core will use.

## Critical Rules

- Do not add `any`, `as any`, `as unknown as`, or JSON round-trip typing hacks.
- Do not expose the full task manager, secret store, crypto session, or `Taskyon` object over the
  protocol.
- Do not add a generic `adminMode: true` flag to ordinary protocol messages.
- Do not move privileged operations into the public protocol just because they are easy to wire.
- Do not create a parallel helper if `createPortClient`, `createPortServer`, or
  `createTaskyonClient` already owns the pattern.
- Keep browser and Node/`tycli` diagnostics compatible.

## Current Boundary

`taskyonProtocol` already covers the right public shape for the first phase:

- task creation
- task-chain creation
- task lookup by id
- file upload
- tool registration
- tool listing
- task update stream
- tool execution stream

The weak boundary is the returned `api` object from `tyCore()`, which still exposes many direct
methods via `createProxyApi(...)`.

## Method Classification

Before moving a method, classify it.

### Public Protocol Candidates

These should generally become `taskyonProtocol` commands:

- `getTaskChain`
- `getTaskIdChain`
- `getMeta`
- `metaUpsert`
- `getToolDefinition`
- `findSiblingLeafTasks`
- `deleteTaskThread`
- `deleteTask`
- `getUploadedFile`
- `getFileMappingByUuid`
- `addFiles`
- `getJsonTaskBackup`
- `addTaskBackup`

### Admin Or Privileged Candidates

These should not be added to the ordinary public protocol. They need an admin protocol extension or
admin port later:

- `deleteAllTasks`
- `syncVectorIndexWithTasks`
- `resetTaskVectors`
- secret-store methods
- `setNewSession`
- API key updates
- profile/settings patches
- binding key/session changes

### Possible Utilities

Inspect these before making them RPC commands. They may belong as client-side utilities or import
helpers instead of core protocol commands:

- `convertTaskIDs`
- `buildSiblingChain`
- `addMdTaskChain`
- `loadYamlConversation`

## One-Method Migration Loop

Use this exact loop for each migrated method:

1. Pick one method from the public candidate list.
2. Add a typed command to `packages/taskyon/packages/taskyon/src/api/taskyonProtocol.ts`.
3. Add the handler in the existing protocol server inside
   `packages/taskyon/packages/taskyon/src/core/init.ts`.
4. Add an ergonomic wrapper in `createTaskyonClient(...)` only if the raw generated client call is
   awkward for callers.
5. Update one real UI/store callsite to use the protocol client instead of `ty.method(...)`.
6. Remove that method from the relevant `createProxyApi(...)` list.
7. Add or update a targeted diagnostic through the normal diagnostics runner if behavior is not
   already covered.
8. Run targeted verification for the changed boundary.

Do not migrate several unrelated methods in one patch unless they share the same request/response
shape and callsite.

## First Recommended Method

Start with `getTaskChain`.

Reason:

- It is a read-only public operation.
- It is widely useful to chat UI clients.
- It has a clear request/response shape.
- It does not require admin privileges, secrets, session switching, storage policy, or destructive
  behavior.

Expected protocol shape:

- Request: task id.
- Response: ordered task chain for that id.
- Error behavior: preserve the existing task-manager behavior as closely as possible. Do not invent
  a new fallback or silent empty result unless the current method already does that.

## Verification

Use targeted checks. Do not run broad lint unless explicitly requested.

Useful verification targets:

- protocol command diagnostic for the migrated operation
- browser-compatible diagnostics runner path
- `tycli` diagnostics path when the command is used by CLI/headless flows
- targeted typecheck/build if the changed package already has a local command

If broad `yarn lint` is not run, say so explicitly in the final handoff.
