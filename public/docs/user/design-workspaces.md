# Design Workspaces

Taskyon design workspaces turn a computational graph into a reproducible project. Open the Design
App from the application menu, or choose one of the prepared design graphs on the home page.

Choosing a prepared example imports its immutable graph objects into Taskyon's local
StorageClient-backed repository and creates a normal project ref. The example then follows the same
load, run, inspect, and Git synchronization path as any other project; it is not a separate demo
runtime.

## Project structure

A project ref is a stable branch-like name. It points to an immutable project revision, which names
one or more invocations. Each invocation selects an exact computational root and its input domains.
The computational nodes themselves live in the shared design graph rather than being copied into
each project.

This distinction lets a project move to a new revision while an exact revision URL remains
reproducible.

## Workspace tabs

- **Graph** shows the project revision, its selected invocation, the computational closure, and the
  ref when the workspace was opened through a ref.
- **Node** opens the source and schemas for the selected computational node. Its upstream and
  downstream links navigate within the same graph.
- **Run** accepts constant parameters as JSON and shows the latest terminal run and result.
- **Git** synchronizes the selected project projection with a configured Git branch.

Select the invocation in the workspace toolbar before running when a project contains more than
one. Selecting a computational node in the graph opens its Node tab.

## Graph controls

Reusable Taskyon graph views can expose flow, vertical, and organic layouts. They can also hide or
show individual nodes, enable or disable panning, zooming, and node dragging, fit all visible nodes,
focus the selected node, copy a PNG, and export an SVG. Search, filters, tree, graph, and list modes
are available when the host workspace enables them.

Search and filters change only the visible view. They do not delete nodes or change the selected
project revision. List views may expose batch actions, but the host decides which nodes are
selectable and which actions are allowed.

## Git synchronization

The Git tab asks for a repository URL, branch, author, and commit message. Browser remotes may also
need credentials and a CORS proxy. Credentials are used for the current synchronization only and
are not stored with the saved Git settings.

StorageClient remains the authoritative working copy. Git receives a validated projection of the
selected project: its ref, project revision ancestry, invocation definitions, project extensions,
and required stored-node closure. Secrets, personal UI state, caches, execution attempts, run
records, and result blobs are excluded.

Synchronization fast-forwards in either direction when one history contains the other. If local
and remote histories diverge, Taskyon reports a conflict and does not overwrite either side.

Taskyon's current general StorageClient path is trusted-local plaintext. See
[Files, Storage, and Secrets](storage-and-security.md) for the current security boundary.
