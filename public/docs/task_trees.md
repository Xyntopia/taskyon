# Taskyon Whitepaper: Immutable TaskNodes in a Dynamic TaskTree

## 1. Introduction

Taskyon is a distributed system designed to manage and execute tasks in a **peer-to-peer environment** using a **TaskTree** structure. Inspired by dependency graphs, workflow engines, and call stacks, Taskyon breaks complex tasks into manageable sub-tasks that can be executed sequentially or in parallel. Each task is represented as an immutable **TaskNode**, ensuring cryptographic integrity and content-addressability while allowing for **dynamic orchestration** using Large Language Models (LLMs).

This whitepaper outlines Taskyon’s architecture, cryptographic guarantees, versioning mechanisms, and how LLMs influence TaskTree evolution.

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
- **Metadata:** Includes mutable properties such as access control lists (ACLs), versioning, and linkage information.
- **Signature:** Each TaskNode is cryptographically signed to ensure authenticity.

#### Example JSON Representation

```json
{
  "content": {
    "data": "Task description or command",
    "contentAddress": "sha256:..."
  },
  "metadata": {
    "parentID": "sha256:parentHash",
    "priorID": "sha256:priorTaskHash",
    "version": 1,
    "editor": "pubkey:editorXYZ",
    "timestamp": 1680000000,
    "acl": ["pubkey:owner", "pubkey:editor1", "pubkey:editor2"]
  },
  "signature": "sig:..."
}
```

## 4. Cryptographic Signatures and Access Control

### Signature Mechanics

- **Signing Process:** TaskNodes are signed by the creator’s private key, covering the content, parent linkage, version, and editor ID.
- **Verification:** Peers validate the signature against the editor’s public key, ensuring authenticity and preventing tampering.

### Enforcing ACLs

- **Root-Level Authority:** The root TaskNode defines the ACL, specifying who can append new nodes.
- **Editor Delegation:** Multiple editors can be authorized, with public keys embedded in the ACL.
- **Append-Only Model:** Instead of modifying existing nodes, new nodes are appended, preserving an immutable task history.

## 5. Versioning and Conflict Avoidance

### Sequential Versioning

- **Single Editor Updates:** A version number or timestamp ensures ordered updates.
- **Multi-Editor Support:** In multi-editor scenarios, TaskNodes form an append-only log, preventing direct conflicts.

### Branching and Merging

- **ParentID Linkage:** Each update references a parent TaskNode, ensuring structured evolution.
- **Conflict Resolution:** Branching is explicit, and higher-level logic (or CRDTs) can be used to merge competing updates.

## 6. Dynamic Task Orchestration with LLMs

### LLM-Driven TaskTree Evolution

Taskyon integrates LLMs to dynamically generate and manage task trees:

- **Adaptive Task Decomposition:** LLMs break down high-level tasks into structured sub-tasks.
- **Flexible Execution Flow:** The task tree adapts in real-time based on user input and intermediate results.
- **Task Dependency Management:** The LLM ensures that generated task dependencies follow logical and executable sequences.

### Recording and Freezing TaskTrees

- **Task Replayability:** Task trees can be recorded for reproducibility.
- **Freezing Defined Processes:** Some branches can be locked while others remain flexible, enabling structured yet adaptable workflows.
- **LLM as a Programming Model:** Since tasks can invoke arbitrary functions (e.g., executing Python code or processing files), Taskyon effectively enables **LLM-driven programming** within its task execution model.

## 7. Integration with Additional Project Data

- **File References:** TaskNodes can reference external files using content-addressed storage.
- **Unified Exchange:** TaskNodes bundle immutable content and metadata for seamless peer-to-peer exchange.

## 8. Conclusion

Taskyon combines immutable, cryptographically secure TaskNodes with LLM-driven task orchestration. By leveraging content-addressability, versioning, and ACL-based access control, it ensures a **distributed, conflict-resistant, and dynamically evolving** task management system. This unique combination positions Taskyon as a robust platform for secure, scalable, and AI-enhanced workflows.
