# Immutable TaskNodes in a Dynamic TaskTree

## 1. Introduction

Taskyon is a distributed system designed to manage and execute tasks in a **peer-to-peer environment** using a **TaskTree** structure. Inspired by dependency graphs, workflow engines, and call stacks, Taskyon breaks complex tasks into manageable sub-tasks that can be executed sequentially or in parallel. Each task is represented as an immutable **TaskNode**, ensuring cryptographic integrity and content-addressability while allowing for **dynamic orchestration** using Large Language Models (LLMs).

This document outlines Taskyon's architecture, cryptographic guarantees, implementation details, and how LLMs influence TaskTree evolution.

## 2. Architectural Overview

### Immutable TaskNodes and Content Addressing

- **Immutability:** Every TaskNode is **content-addressed** via a SHA-256 hash. Once created, a TaskNode's content and core metadata cannot be altered. Any change results in a new TaskNode.
- **Content Addressing:** The cryptographic hash acts as a globally unique identifier, enabling efficient peer-to-peer exchange and eliminating the need for traditional conflict resolution on updates.

### TaskTree Structure

Taskyon implements task trees using immutable `TaskNode` entities connected through two types of relationships:

1. **`parentID`**: Links to the parent task that created this subtask (hierarchical relationship)
2. **`priorID`**: Links to the previous task in the same chain (sequential dependency)

The system maintains caches to efficiently traverse these relationships in both directions.

#### Core Structural Concepts

- **Hierarchical and Sequential Links:** TaskNodes reference their **parentID** (denoting hierarchical relationships) and **priorID** (capturing sequential dependencies). This linkage forms a structured TaskTree where tasks build upon each other.
- **Subtasks and Results:** New tasks are appended as child TaskNodes, preserving context while keeping each node immutable.
- **Task Execution and Propagation:** Task results propagate upwards in the tree, similar to function return values in programming. This is done through a tree flattening operation.

#### Task Chain Processing and Parallelization

Taskyon's execution model distinguishes between sequential processing within a single task chain and parallel execution across independent chains. Key aspects include:

- **Sequential Processing within Chains:**  
  Tasks within a single chain are processed one after another - each task consumes the output of its predecessor, ensuring a coherent, step-by-step evolution of state. Each task waits until its prior chain is finished (often signaled by a `return` task in child chains).

- **Parallel Execution of Subchains:**  
  While individual chains maintain sequential execution, distinct chains (or subchains spawned by function tasks) can be processed concurrently, optimizing overall throughput.

- **Parent-Child Relationships and Sibling Tasks (current implementation):**
  - When a `functioncall` task is executed, any tasks returned by the tool are appended as **child chains** with `parentID = <functioncall task id>`.
  - Within each returned chain, tasks are linked by `priorID` (sequential order).
  - User-initiated messages are typically appended **as a continuation of the selected chain** (via `priorID`), not as children. This keeps user input in the same sequential thread unless a tool explicitly spawns subtasks.
  - Because TaskNodes are immutable, Taskyon does not store explicit `childrenIDs` or `nextID` pointers. Traversal is done by searching for tasks that reference a given `parentID` / `priorID`.
  - A parent function task is considered finished only when **all child chains have finished**. Ending a child chain with a `return` task makes completion explicit and reliable.

- **Context Rendering for LLM Inference:**  
  The `chatCompletion` tool converts task chains into an OpenAI-compatible message list. Key points:
  - Context is built from `priorID`/`parentID` traversal and flattened in a deterministic order.
  - Tasks can opt out of rendering (e.g., via render options like `hideChat` / `hideLlm`).
  - For simple flows, a single chain is used. For nested subtasks, the tool flattens the tree to preserve the most relevant context.
  - `chatCompletion` parameters (like `context_size` and prompt templates) can further control how much history is included.

## 3. Task Completion Detection

The core logic for determining if a task is finished is implemented in the `isTaskFinished` function. The algorithm works as follows:

### For `functioncall` tasks

Checks if all subtasks are finished by calling `areAllSubtasksFinished`

### For `return` tasks

Always considered finished (they signal completion)

### For other tasks

Recursively checks if the prior task (`priorID`) is finished

### Subtask Completion Logic

The `areAllSubtasksFinished` function checks completion by:

- Finding all direct children of the task
- Getting the leaf tasks of each child chain
- Checking if each leaf task is finished recursively

### Continuation Logic

Before processing a task, the task worker checks if the prior task is finished. If the prior task isn't finished, the current task is pushed back onto the queue and waits (sleeps for 500ms) before retrying.

After executing a task, new tasks are queued for processing. The system also optimizes by marking tasks as finished when their result chains contain no `functioncall` tasks.

### Performance Optimizations

The system uses caching (`isFinishedCache`) to avoid repeatedly checking the same tasks. The design ensures that tasks within a chain execute sequentially while allowing parallel execution across independent chains. The immutability of `TaskNode` entities means that once created, they cannot be modified, which simplifies the completion tracking logic.

## 4. Data Structures

### TaskNode Structure

Each TaskNode contains:

- **Content:** The immutable payload, which may include descriptions, commands, or other task-specific data.
- **Metadata:** Immutable properties such as access control lists (ACLs) and linkage information. _Changes to metadata require appending a new TaskNode._
- **Signature:** Each TaskNode is cryptographically signed to ensure authenticity.

#### Example JSON Representation

This is a rough outline. Newer version of taskyon might have updated this structure already.

```json
{
  "role": "assistant",
  "name": "exampleTask",
  "content": {
    "type": "message",
    "data": "This is an example task description."
  },
  "label": ["example"],
  "parentID": "sha256:parentTaskHash",
  "priorID": "sha256:priorTaskHash",
  "id": "sha256:exampleTaskHash",
  "authorId": "pubkey:authorXYZ",
  "created_at": 1680000000,
  "acl": ["pubkey:owner", "pubkey:editor1"],
  "sig": "sig:exampleSignature"
}
```

### Internal Data Structures

The system maintains several map structures for efficient traversal:

- **nextSiblingMap**: Maps tasks to their next siblings
- **parentToChildMap**: Maps parent tasks to all their children
- **immediateChildrenMap**: Maps tasks to their immediate children

These caches enable bidirectional traversal of the task tree without modifying the immutable TaskNodes.

## 5. Cryptographic Signatures and Access Control

### Signature Mechanics

- **Signing Process:** TaskNodes are signed by the creator's private key, covering the content, parent linkage, and editor ID.
- **Verification:** Peers validate the signature against the editor's public key, ensuring authenticity and preventing tampering.

### Enforcing ACLs

- **Root-Level Authority:** The root TaskNode defines the ACL, specifying who can append new nodes.
- **Editor Delegation:** Multiple editors can be authorized, with public keys embedded in the ACL.
- **Append-Only Model:** Instead of modifying existing nodes, new nodes are appended, preserving an immutable task history.

### Immutable Metadata and Permission Evolution

Instead of mutable metadata, Taskyon treats metadata as immutable. Permission changes (e.g., ACL updates) are recorded by appending new TaskNodes to the TaskTree. This ensures cryptographic integrity while allowing dynamic policy evolution.

#### How It Works

- **Permission Update Nodes:**  
  An authorized editor appends a TaskNode with updated ACL rules in its metadata. This node is immutable and signed, serving as a tamper-proof record of the change.

- **Chain of Authority:**  
  Subsequent TaskNodes reference their **parentID** or **priorID**, forming a directed chain. The effective permissions for any node are derived by traversing backward to the most recent permission update in its lineage.

- **Verification Workflow:**  
  When processing a TaskNode, clients:
  1. Validate the signature of the current node.
  2. Traverse the chain to resolve the effective ACL (or use cached state for efficiency).
  3. Confirm the editor's public key is authorized under the latest ACL.

#### Pros & Cons

**Pros:**

- **Full Immutability:** No in-place updates; all changes are append-only.
- **Audit Trail:** The TaskTree itself becomes a verifiable history of permission changes.
- **Conflict Avoidance:** Immutable nodes simplify peer-to-peer exchange.

**Cons:**

- **Chain Traversal Overhead:** Clients must resolve permissions by walking the TaskTree (mitigated by caching).
- **Branch Merging Complexity:** Conflicting permission updates in parallel branches require resolution rules (e.g., "latest timestamp wins").

## 6. Dynamic Task Orchestration with LLMs

### LLM-Driven TaskTree Evolution

Taskyon integrates LLMs to dynamically generate and manage task trees:

- **Adaptive Task Decomposition:** LLMs break down high-level tasks into structured sub-tasks.
- **Flexible Execution Flow:** The task tree adapts in real-time based on user input and intermediate results.
- **Task Dependency Management:** The LLM ensures that generated task dependencies follow logical and executable sequences.

### Recording and Freezing TaskTrees

- **Task Replayability:** Task trees can be recorded for reproducibility. Taskyon can condense the trees into
  new functions/tools in order to speed up subsequent repetitions.
- **Freezing Defined Processes:** Some branches can be locked while others remain flexible, enabling structured yet adaptable workflows.
- **LLM as a Programming Model:** Since tasks can invoke arbitrary functions (e.g., executing Python code or processing files), Taskyon effectively enables **LLM-driven programming** within its task execution model. Taskyon is effectively "spontaneously" generating new code during the execution of a program.

## 7. Integration with Additional Project Data

- **File References:** TaskNodes can reference external files using content-addressed storage.
- **Unified Exchange:** TaskNodes bundle immutable content and metadata for seamless peer-to-peer exchange.

## 8. Conclusion

Taskyon combines immutable, cryptographically secure TaskNodes with LLM-driven task orchestration. By leveraging content-addressability, ACL-based access control, and immutable metadata, it ensures a **distributed, conflict-resistant, and dynamically evolving** task management system.

The implementation uses sophisticated caching and traversal strategies to efficiently determine task completion status while maintaining the integrity guarantees of immutable data structures. This unique combination positions Taskyon as a robust platform for secure, scalable, and AI-enhanced workflows that can execute both sequentially and in parallel while maintaining cryptographic verifiability.
