# Design Graphs And Workspaces

Taskyon's design-graph implementation is shared by browser and Node hosts. `@taskyon/comp-dag`
owns graph identity, traversal, stored-node compilation, invocations, runs, repository persistence,
and Git projections. `@taskyon/ui` owns reusable graph and workspace interactions. Host
applications provide composition, labels, commands, and storage capabilities.

## Node identity and origin

There are two supported definition origins:

- `hard-coded` nodes are supplied by a trusted runtime;
- `stored` nodes are loaded from TypeScript source in the writable design-graph repository.

Both compile to the same `DagNode` execution type. Stored nodes are content addressed and editable
through immutable replacement; imported bundles and Git repositories are import sources, not a
third read-only node category.

Definition origin is independent from execution effect. A `pure` node computes only from declared
inputs, while a `source` node observes an external environment. A stored node may be pure or a
source, and a hard-coded node may be pure or a source. Graph presentations therefore carry both
`definitionOrigin` and `isSource` rather than encoding either fact in one color or label.

`dagNodeRecordGraph.ts` owns stored-record indexing, closure and relation traversal, deletion
planning, immutable input rewrites, default merging, and graph compilation. `dagGraphView.ts`
projects runtime nodes into presentation data; it is not the compiler or repository.

## Source observations

Source nodes use immutable `SourceLockManifest` records to bind one observation to the exact node,
acquisition key, parameters, artifact, and timestamp. The source execution configuration selects a
refresh policy:

- `none` and `manual` reuse an existing manifest unless explicitly forced;
- `stale` refreshes after its configured duration;
- `always` refreshes once per execution run.

Projects may pin a source manifest without changing the immutable manifest itself. The environment
diagnostics classify definite source nodes and potential pure leaves so a host can explain which
values come from observations and which may still need user-supplied data.

## Repository object model

The StorageClient-backed design repository stores one shared immutable object pool:

```text
nodes/<content-hash>.ts
graph-revisions/<content-hash>.json
project-revisions/<content-hash>.json
invocations/<content-hash>.json
extensions/<content-hash>.json
refs/<ref-name>.json
```

A graph revision maps names to immutable node hashes. A project ref points to a project revision;
the revision records parent hashes, a display name, friendly invocation names, and namespaced
extension hashes. Each invocation selects its computational root and input domains. Projects share
the global node pool and do not own copied node catalogs.

Source-observation locks currently use the separate `SourceManifestRepository` over logical
StorageClient namespaces. The Git projection recognizes a `source-manifests` directory, but project
snapshots do not infer source locks from a computational closure.

Execution attempts contain mutable progress and checkpoints. A terminal `InvocationRun` contains
resolved execution identity, status, provenance, and named artifact hashes. Row artifacts and
their access index remain streamable so consumers do not need to materialize an entire study in
memory.

## Git projections

Git is a synchronization projection above the authoritative StorageClient repository, not a
StorageClient backend. `projectDesignGraphSnapshot` can project:

- the complete global repository;
- one project ref with its revision ancestry, invocations, extensions, and node closure;
- one graph revision with its ancestry and node closure;
- one node and its upstream closure.

Imports validate paths, schemas, content hashes, and closure references. Immutable objects are
written before refs, and refs use expected-current conditional writes. Synchronization only
fast-forwards: equal histories are unchanged, an ahead side is pushed or pulled, and divergent
histories return `conflict` without an automatic merge.

The browser adapter uses isomorphic-git with a private IndexedDB working tree. The Node adapter
uses a normal Git working directory. Both implement the same `DesignGraphGitSynchronizer` contract
and feed the same projection/import logic.

`DesignGraphGitSyncPane.vue` is the reusable UI boundary. The host owns its settings and injects a
`synchronize` function for the chosen snapshot selector. Authentication values stay transient;
the pane does not import a host store or persist credentials.

## Reusable graph views

`GraphCanvas.vue` renders generic `GraphData`. Its `GraphPresentationState` contains the stable
layout choice plus pan/zoom and node-drag preferences. Hosts may persist that small configuration
at their composition boundary while keeping selection, search, filters, camera position, and
temporary visibility local.

`GraphCanvasControls.vue` provides flow, vertical, and organic layouts, per-node visibility,
pan/zoom, node dragging, fit-visible, focus-selected, PNG copy, and SVG export.

`DagGraphExplorer.vue` composes the canvas with tree, graph, and list modes. It owns local search,
filtering, list selection, and context-menu positioning. Hosts opt into node creation and inject
toolbar, batch, node-action, and context-menu slots; the reusable component does not assume a
domain-specific create or delete policy.

## Workspace composition

`DockView.vue` supports leaf regions named `navigation`, `document`, and `tools`. A split inherits
the target region unless the host explicitly chooses another one, so opening a document does not
depend on whichever pane happened to be focused most recently. The add-pane menu searches the
host-provided view catalog.

`WorkspaceShell.vue` groups workspace entries by an optional `section` and supports an expanded or
compact navigation rail. Reusable panes do not import application-wide stores. The top-level page
or workspace host owns persisted widget configuration and passes each pane only its relevant
state and actions.

## Package boundaries

- `@taskyon/common/modules/graph` owns generic graph data, layout mapping, rendering, and
  presentation-state types.
- `@taskyon/comp-dag` owns computational DAG semantics and graph repository algorithms.
- `@taskyon/ui` owns reusable Vue graph, editor, Git-sync, and docking components.
- browser and Node packages own their storage, sandbox, and Git adapters.
- host applications own product navigation, project defaults, domain filters, commands, markers,
  and theme values.

Use package exports rather than relative imports across these boundaries. The packages remain
experimental, so their current source exports are not a stable third-party API.
