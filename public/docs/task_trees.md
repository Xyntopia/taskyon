# Taskyon Whitepaper: Immutable TaskNodes in a Dynamic TaskTree

TODO:

- explain:
  - tasks inside of a chain have to be processed sequentially. chains (e.g. as subchains of tasks) can be processed in parallel.
  - tasks returned from a functionTask will get the "parentID" assigned to them and counted as a "subtask"
  - tasks added by the user (e.g. as a chatResponse) will be "siblings" to the selected leaf task in a specific chat
  - chatCompletion will figure out which is the correct context to render and convert into a message chain for llm inference
    - if there is only one subtask chain, we will probably simply render it
    - some task/functions automatically indicate that they would not like to be rendered in the chat this is for example
    - the case for chatCompletion itself.
    - we should probably add some options to chatCompletion to influence that behaviour for certain situations. E.g. maybe for debugging in case of an error, we want all details to be included.... But maybe for task planning we only want the top-level stuff to be included...

## 1. Introduction

Taskyon is a distributed system designed to manage and execute tasks in a **peer-to-peer environment** using a **TaskTree** structure. Inspired by dependency graphs, workflow engines, and call stacks, Taskyon breaks complex tasks into manageable sub-tasks that can be executed sequentially or in parallel. Each task is represented as an immutable **TaskNode**, ensuring cryptographic integrity and content-addressability while allowing for **dynamic orchestration** using Large Language Models (LLMs).

This whitepaper outlines Taskyon’s architecture, cryptographic guarantees, and how LLMs influence TaskTree evolution.

## 2. Architectural Overview

### Immutable TaskNodes and Content Addressing

- **Immutability:** Every TaskNode is **content-addressed** via a SHA-256 hash. Once created, a TaskNode's content and core metadata cannot be altered. Any change results in a new TaskNode.
- **Content Addressing:** The cryptographic hash acts as a globally unique identifier, enabling efficient peer-to-peer exchange and eliminating the need for traditional conflict resolution on updates.

### TaskTree Structure

- **Hierarchical and Sequential Links:** TaskNodes reference their **parentID** (denoting hierarchical relationships) and **priorID** (capturing sequential dependencies). This linkage forms a structured TaskTree where tasks build upon each other.
- **Subtasks and Results:** New tasks are appended as child TaskNodes, preserving context while keeping each node immutable.
- **Task Execution and Propagation:** Task results propagate upwards in the tree, similar to function return values in programming.

## 3. Data Structures

### TaskNode Structure

Each TaskNode contains:

- **Content:** The immutable payload, which may include descriptions, commands, or other task-specific data.
- **Metadata:** Immutable properties such as access control lists (ACLs) and linkage information. _Changes to metadata require appending a new TaskNode._
- **Signature:** Each TaskNode is cryptographically signed to ensure authenticity.

#### Example JSON Representation

This is a rough outline and not the exact structure used
in the most recent version of taskyon. It is only there
to give a general idea of what the system looks like.

```json
{
  "content": {
    "data": "Task description or command",
    "contentAddress": "sha256:..."
  },
  "metadata": {
    "parentID": "sha256:parentHash",
    "priorID": "sha256:priorTaskHash",
    "editor": "pubkey:editorXYZ",
    "timestamp": 1680000000,
    "acl": ["pubkey:owner", "pubkey:editor1", "pubkey:editor2"]
  },
  "signature": "sig:..."
}
```

---

## 4. Cryptographic Signatures and Access Control

### Signature Mechanics

- **Signing Process:** TaskNodes are signed by the creator’s private key, covering the content, parent linkage, and editor ID.
- **Verification:** Peers validate the signature against the editor’s public key, ensuring authenticity and preventing tampering.

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
  3. Confirm the editor’s public key is authorized under the latest ACL.

#### Pros & Cons

**Pros:**

- **Full Immutability:** No in-place updates; all changes are append-only.
- **Audit Trail:** The TaskTree itself becomes a verifiable history of permission changes.
- **Conflict Avoidance:** Immutable nodes simplify peer-to-peer exchange.

**Cons:**

- **Chain Traversal Overhead:** Clients must resolve permissions by walking the TaskTree (mitigated by caching).
- **Branch Merging Complexity:** Conflicting permission updates in parallel branches require resolution rules (e.g., "latest timestamp wins").

---

## 5. Dynamic Task Orchestration with LLMs (Excerpt)

### LLM-Driven TaskTree Evolution

Taskyon integrates LLMs to dynamically generate and manage task trees:

- **Adaptive Task Decomposition:** LLMs break down high-level tasks into structured sub-tasks.
- **Flexible Execution Flow:** The task tree adapts in real-time based on user input and intermediate results.
- **Task Dependency Management:** The LLM ensures that generated task dependencies follow logical and executable sequences.

### Recording and Freezing TaskTrees

- **Task Replayability:** Task trees can be recorded for reproducibility.
- **Freezing Defined Processes:** Some branches can be locked while others remain flexible, enabling structured yet adaptable workflows.
- **LLM as a Programming Model:** Since tasks can invoke arbitrary functions (e.g., executing Python code or processing files), Taskyon effectively enables **LLM-driven programming** within its task execution model.

## 6. Integration with Additional Project Data

- **File References:** TaskNodes can reference external files using content-addressed storage.
- **Unified Exchange:** TaskNodes bundle immutable content and metadata for seamless peer-to-peer exchange.

## 7. Conclusion

Taskyon combines immutable, cryptographically secure TaskNodes with LLM-driven task orchestration. By leveraging content-addressability, ACL-based access control, and immutable metadata, it ensures a **distributed, conflict-resistant, and dynamically evolving** task management system. This unique combination positions Taskyon as a robust platform for secure, scalable, and AI-enhanced workflows.
