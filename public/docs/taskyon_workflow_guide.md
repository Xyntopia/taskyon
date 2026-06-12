# Taskyon Workflow Guide (Concise Workflow Builder’s Manual)

This document is for **AI agents and human developers** who want to:

- build **custom workflows** (like CodingPage / SqlPage),
- design **entry nodes**, and
- implement **tools** correctly and safely.

---

## 1. Core Mental Model

Think of Taskyon as:

- an **immutable task tree** (log of what happened),
- a **task worker** that executes function calls in the right order,
- a **tool layer** that returns new tasks,
- and an **LLM gateway** (`chatCompletion`) that plans, explains, or chooses tools.

### 1.1 Task Basics

Each task node has:

- `content.type` ∈  
  `message | functioncall | toolresult | structured | files | error | return | tooldefinition`
- `role` ∈ `system | user | assistant | function`
- `priorID` – previous task on the same level (sequential chain)
- `parentID` – parent `functioncall` that spawned this task (subtask)

**Execution rule**

- **Only** tasks with `content.type = 'functioncall'` are executed.
- Everything else is context or control signals.

### 1.2 Completion Rules

A task is _finished_ when:

- `return` → always finished.
- Non-function task:
  - if it has `priorID` → finished when the prior chain is finished,
  - otherwise → finished immediately.
- `functioncall` → finished only when **all its subtask chains** (children via `parentID`) have reached their ends.

**Consequence:** A single `functioncall` can “own” many parallel or sequential sub-workflows.

---

## 2. Design Rules & Invariants

### 2.1 Non‑Negotiable Invariants

- Tasks are **immutable**; never edited after creation.
- Chains are formed only via:
  - `priorID` (linear sequence on one level),
  - `parentID` (subtask chain owned by a `functioncall`).
- A `functioncall` **must not** rely on synchronous return values; its “output” is the subtask chains it creates.

### 2.2 Minimal Valid Workflow

The smallest reasonable workflow:

```text
[optional files]
→ user message (content: message)
→ entry node (content: functioncall to some tool)
→ result tasks (typically message + return)
```

**Recommended leaf pattern:**

```ts
return makeTaskResult([
  [
    { role: 'assistant', content: { type: 'message', data: 'Done.' } },
    { role: 'system', content: { type: 'return', data: 'OK' } },
  ],
])
```

This makes completion unambiguous.

### 2.3 Common Traps

**Silent wrong behavior**

- Returning **plain values** from tools when you _didn’t intend_ to involve the LLM:
  - Tool result is auto-wrapped as  
    `toolresult → chatCompletion(goal=AnalyzeToolResult)`.
- Not using `allowedTools`:
  - LLM may “escalate” into tools you never intended.
- Ending chains without `return`:
  - Still technically valid, but completion and UX become fuzzy.

**Deadlocks / hanging graphs**

- `functioncall` that spawns subtasks but no subtask ever ends (e.g. no `return`, infinite recursion).
- Tasks that depend on unfinished `priorID` chains.

**Tree explosion**

- Recursive tool → LLM → tool without a base case.
- Error handlers that keep retrying the same failing tool indefinitely.

---

## 3. Entry Nodes

The **entry node** is the first `functioncall` after the user’s message.

### 3.1 When to Use Custom Entry Nodes

Use a **custom entry node** instead of the default `taskyonFlow` when:

- You need to inject **rich, domain-specific context**  
  (e.g. current code with line numbers, DB schema, previous results).
- You want **tight focus**: only a small, known set of tools should ever be called.
- You want **deterministic behavior**, or even **no LLM involvement** at all.
- You want a **custom UX** (e.g. always start with a planning step).

If you don’t specify one, Taskyon uses:

```ts
entryNode = toolCall({ name: 'taskyonFlow', arguments: {} })
```

`taskyonFlow` is the default orchestration entry node. It may run a shortlist phase before
issuing a narrowed `chatCompletion(goal=ChooseTool, allowedTools=[...])` step.

### 3.2 What an Entry Node May Do

An entry node **may**:

- call **multiple tools**,
- spawn **parallel chains** (2D `makeTaskResult`),
- **short-circuit** (e.g. compute something and immediately `return`),
- skip the LLM entirely and just do deterministic work.

Entry node **contract**:

- It **must** return tasks (`makeTaskResult` or plain value → auto-wrapped).
- It **should**:
  - end sub-workflows with `return`,
  - use `chatCompletion(goal=ChooseTool, allowedTools=[...])` only when LLM is expected to choose tools.

### 3.3 Entry Node Patterns

**Pattern A – Context builder + restricted tools** (CodingPage, common)

```text
entryNode: documentAssistant
  → build context prompt (document state, rules)
  → chatCompletion(goal=ChooseTool, allowedTools=[updateDocument])
  → updateDocument tool applies concrete edits
```

**Pattern B – Self-looping setter** (SqlQueryPage)

```text
entryNode/tool: setSqlQuery

if no sql:
  → build SQL + schema prompt
  → chatCompletion(goal=ChooseTool, allowedTools=[setSqlQuery])
else:
  → set SQL in UI
  → message + return
```

**Pattern C – Fallback orchestrator** (default `taskyonFlow`)

- Use when you want a generic router that can stay in plain chat mode or narrow the tool set
  before tool choice.

---

## 4. Task Graph Construction

### 4.1 Sequential vs Parallel

**Sequential within one chain**

```ts
return makeTaskResult([
  [
    taskA, // no priorID (start)
    taskB, // priorID = taskA.id
    taskC, // priorID = taskB.id
  ],
])
```

**Parallel sub-chains**

```ts
return makeTaskResult([
  [chain1_step1, chain1_step2],
  [chain2_step1, chain2_step2],
])
```

- All inner arrays are separate chains with their own `priorID` links.
- All these chains have the same `parentID` (the spawning `functioncall`).

### 4.2 Legal / Illegal Shapes

**Allowed endings**

- `return` (preferred – explicit control signal),
- `message` or `toolresult` as last task (implicitly “done” when prior chain is done).

**Multiple children with same `parentID`**

- Yes. That’s exactly how parallel subtask chains are represented.

**Anti‑patterns**

- `parentID` referencing a non‑`functioncall` task → breaks semantics.
- Manual cross‑wiring `priorID` between logically separate chains.
- Creating loops in `priorID`.

---

## 5. Tools: Contract & Best Practices

### 5.1 Minimal Correct Tool

```ts
const myTool = createTool({
  name: 'myTool',
  description: 'Short LLM-friendly description',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  } as const,
  async function({ query }, ctx) {
    // do work
    return makeTaskResult([
      [
        { role: 'assistant', content: { type: 'message', data: `Got: ${query}` } },
        { role: 'system', content: { type: 'return', data: 'OK' } },
      ],
    ])
  },
})
```

Tools receive a `toolContext`:

- `taskChain` – ordered list of tasks leading here (for context inspection),
- `getSecret`/`setSecret` – credentials,
- `stopSignal` – for cancellations,
- `toolId`, `messagePort?` – for identification / duplex communication.

### 5.2 Returning Results

**Option 1 – Plain values**

```ts
return { foo: 123 }
```

- Framework wraps this as:

```text
toolresult({foo:123})
→ chatCompletion(goal=AnalyzeToolResult)
```

Use when:

- you _want_ the LLM to explain/format/decide what to do next.

Avoid when:

- you want deterministic follow-up (no extra LLM hop).

**Option 2 – Explicit task chains (`makeTaskResult`)**

Use when:

- you care about workflow control, UX, and cost.
- you want to call other tools, or end with a specific `message`/`return`.

**Guideline:**  
For **workflow tools** (orchestration), **always** use `makeTaskResult`.  
For small helper tools whose result should be “interpreted by the AI”, plain values are acceptable.

### 5.3 Inspecting Context

Tools **can**:

- read `context.taskChain` to:
  - see the last user message,
  - inspect previous tool calls / results,
  - change behavior based on history.

Tools **can** intentionally leave chains without a `return`, but:

- this makes completion and UI status less clear,
- reserve this for advanced custom patterns.

---

## 6. LLM Boundary, Planning & `allowedTools`

### 6.1 Responsibilities

**LLM (via `chatCompletion`)**

- Plans within _allowed tools_:
  - can choose tools (typically via entry-node-driven routing),
  - parameterizes tool calls,
  - interprets tool results (`AnalyzeToolResult`),
  - handles recovery prompts provided by the entry node.

**Task worker / tools**

- Enforce sequencing and completion.
- Actually **execute** tools.
- Define the **workflow structure** by returning new tasks.

**Recursive tool ↔ LLM ↔ tool**

- Normal and powerful (e.g. multi-step wizards).
- Dangerous only if there’s no base case or no `allowedTools` restrictions.

### 6.2 `allowedTools`: Safety & Determinism

- Treat `allowedTools` as **mandatory** in serious workflows.
- Without it:
  - the LLM can **hallucinate** tool names,
  - or call tools you didn’t intend to expose.

You can **change `allowedTools` dynamically** per `chatCompletion` call to:

- gradually expand access,
- restrict error handlers to specific tools, etc.

**Prevent escalation by:**

- always specifying `allowedTools` in orchestration calls,
- using narrow tool sets in entry nodes,
- giving clear tool descriptions.

---

## 7. Errors & Recovery

### 7.1 Error Semantics

When a tool throws:

1. An `error` task is created as a **subtask** of the failing `functioncall`.
2. A follow‑up `entryNode` task is appended.
3. That error handler chain is executed like any other subchain.

Workflow authors control via:

- `maxAutonomousTasks` (how many autonomous steps before hard stop),
- custom `entryNode` behavior (define your own error routing and retry policy).

### 7.2 What Error Handlers May Do

Error workflows **may**:

- call tools (e.g. retry with different args, log, notify),
- mutate external state,
- terminate with `return` or continue into more complex recovery flows.

In production workflows, you’re expected to **override** the default error behavior for important flows.

---

## 8. Parallelism

- Parallelism appears when a tool returns **multiple chains** (`makeTaskResult` with 2D arrays).
- Taskyon guarantees:
  - **sequential** order inside each chain (`priorID`),
  - **independent** execution of sibling chains,
  - parent `functioncall` finishes only after **all** child chains are finished.

Tools themselves run in isolated task executions; treat them as logically **stateless** functions. Any real shared state must live in your own storage and be designed for concurrency.

Parallelism is a **core feature**, not a toggle.

---

## 9. `return` Semantics

- `return` is a **control signal**, not a data channel.
- It means: “this subtask chain is done.”
- It does **not** automatically propagate data upward; parents infer completion from state, not content.

**Recommended rule:**

- Have **exactly one `return` per logical sub-workflow chain**.
- For parallel branches, each branch can have its own `return`.

If you need to “return data” to a parent, encode it as:

- `message`, `structured`, or `toolresult` content,
- or shared application state—not `return.data`.

---

## 10. State & Persistence

Taskyon is designed to manage:

- **immutable task trees** (history),
- task metadata (prompts, tool usage, token costs),
- task relationships and execution state.

Taskyon is **not** responsible for:

- your business/domain state (files, DBs, editor contents),
- long‑term pruning/archival strategies.

Use the task tree as an **audit log**, not as your only source of truth.

Pruning/summarization is an **application concern**:

- delete old subtrees,
- summarize old conversations,
- offload to external storage as needed.

---

## 11. Composition, Patterns & Anti‑Patterns

### 11.1 Composition & Reuse

- Workflows can be nested: any tool can spawn arbitrary subchains.
- Tools are reusable: they’re defined once, called from many workflows.
- Typical structure for large systems:
  1. **Entry node tools** (per UI / page),
  2. **Domain tools** (e.g. `updateDocument`, `setSqlQuery`),
  3. **Utility tools** (e.g. `toolSearcher`, `addNewTool`),
  4. Shared `chatCompletion` gateway.

### 11.2 Explicit “Do / Don’t” Summary

**Do**

- End important chains with `return`.
- Use `makeTaskResult` for orchestration tools.
- Constrain `chatCompletion` with `allowedTools`.
- Put heavy prompt engineering in **entry nodes** and/or tools, not scattered in the UI.
- Use entry nodes to inject domain state (documents, schemas, config).

**Don’t**

- Rely on implicit auto‑wrapping of tool results for complex workflows.
- Let the LLM choose from all tools in production; always restrict.
- Create `parentID` links pointing to non‑`functioncall` tasks.
- Build cycles via `priorID` or infinite self‑calling tools.
- Use the task tree as your sole mutable state store.

---

## 12. Minimal Examples

### 12.1 Minimal Echo Workflow

```ts
const echo = createTool({
  name: 'echo',
  description: 'Echoes a message and stops.',
  parameters: {
    type: 'object',
    properties: { msg: { type: 'string' } },
    required: ['msg'],
  } as const,
  function: async ({ msg }) =>
    makeTaskResult([
      [
        { role: 'assistant', content: { type: 'message', data: msg } },
        { role: 'system', content: { type: 'return', data: 'OK' } },
      ],
    ]),
})

// Entry node:
toolCall({ name: 'echo', arguments: { msg: 'Hello' } })
```

### 12.2 Editor Pattern (Sketch)

```text
entryNode: documentAssistant
  → build context (versions, line numbers, rules)
  → chatCompletion(goal=ChooseTool, allowedTools=['updateDocument'])
  → updateDocument applies patches or replaces content
  → (optionally) message + return
```

### 12.3 SQL Pattern (Sketch)

```text
entryNode/tool: setSqlQuery

If no sql:
  → build context (schema, last query, last results)
  → chatCompletion(goal=ChooseTool, allowedTools=['setSqlQuery'])

If sql:
  → assign sql to editor state
  → message + return
```

---

If you want, next we can:

- design a **template entry node** for your own workflow,
- or draft **tool stubs** for a new page (e.g. API client, multi-file project assistant) following these rules.
