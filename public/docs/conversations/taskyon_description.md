# How are tasks in Taskyon processed?

Every message/task in a "conversation" in taskyon has carefully designed
transitions which define what tasks/messages follow in the chain. This works similar to a state machine.

Inside the source code you can find that right now, there are three main parts to this:

- the taskworker runs the worker loop and executing each task is equivalent to generating a transition
- inside the taskworker there are:
  - the task processor
    - This processes each task and takes the tasks "content" as input and generates a "result"
    - the tasks content can be a function call, a simple message or structured data.
    - Based on the tasks content, the processor will also generate a prompts which direct the LLM inference e.g. to create a specific data format in the response (json/yaml)
    - the output is the result of a function or another message
  - the follow up task generator creates new task(s) based on the result.
- if an error occurs a new task which holds the error as content is generated.

## Task Transitions Map

The Task Transitions Map illustrates the flow and transitions of various content types within taskyon, which operates as an agent. Each node in the diagram represents a specific type of task content. Depending on the content type, new tasks with specific content are created, leading to different processing paths.

We expect all function calls to do one of the following:

- **Return a plain value** -> Taskyon auto-wraps it as `toolresult` and appends `chatCompletion(goal=AnalyzeToolResult)`.
- **Return a task chain** via `makeTaskResult(...)` (sequential or parallel).
- **Return a task chain that ends with `return`** to explicitly signal completion to the parent task.

#### Workflow Description:

In taskyon, the goal is that all functionality resides in tools defined in a
json structure. This helps taskyon to modify its own behaviour and makes AI
assisted tool development possible.
Each tool can itself generate new follow-up tasks and thereby influencing
the shape of the task transition map. So the task processing now involves two layers:

- One layer represents the simple function execution chain.
- The second layer represents the transition between different types of function.
- the previous "structured" messages and all of that now are all handled by a tool which can
  implement its own logic to make conclusions about errors and whether we should use a tool
  for example

Here you can see how functions/toolcall processing becomes the center of how
taskyon works. The relevant parts in the taskyon code representing
this are the "runTaskWorker", "processTask" and "handleFunctionExecution" functions.

```mermaid
---
title: Task Worker (Actual Execution Flow)
---
%%{init: { "flowchart": { "curve": "cardinal", "wrappingWidth": 420 } } }%%
flowchart TB
  A([Task queued]) --> B{Prior chain finished?}
  B -- No --> C[Requeue + wait] --> B
  B -- Yes --> D{Task type?}
  D -- functioncall --> E[Execute tool]
  D -- other --> F[Skip execution]

  E --> G{tool returned taskResult?}
  G -- Yes --> H[Append child chains / parentID]
  G -- No --> I[Append toolresult + entryNode]

  E --> J[Error -> error + entryNode]
  H --> K[Queue new tasks]
  I --> K
```

Taskyon provides a basic Taskflow to get started with and which can automatically
incorporate new tools and generically analyze their results and use it.
The chatCompletion tool in its current form takes the previous tasks and converts them into
a list of messages, adds task-specific prompts and
then sends it to an LLM Service (which can also be local).
When a task becomes more clear and repeats itself
often, it might make sense
to define a new tool which works faster on repeated
or complex tasks then trying to solve a problem
with the generic tools available.
In the UI, user messages are typically followed by an **entry node** (a tool call). The entry
node is now the primary workflow router: it decides the next action and forwards orchestration
settings (prompts, native tool-calling, web search options, reasoning) to `chatCompletion`.
The graph below shows this default workflow.

```mermaid
---
title: Default Workflow (Entry Node Driven)
---
%%{init: { "flowchart": { "curve": "cardinal", "wrappingWidth": 420 } } }%%
flowchart TD
  S([Start]) --> Files[files?]
  Files --> U[User message]
  U --> Entry{{entryNode}}

  Entry --> CT{{chatCompletion<br/>goal=AnalyzeToolResult or WebSearch}}
  CT --> ToolCall{{Tool call}}
  ToolCall --> ToolResult[toolresult]
  ToolResult --> Entry

  CT --> A[Assistant message]

  ToolCall --> Error[error]
  Error --> Entry
```

### Comparison of taskyon's task sequence to a reduce function

The taskchain in the AI chat-app functions similarly to the "reduce" concept in functional programming, where each task builds upon the previous ones, maintaining context throughout the process. Here's a concise explanation:

1. **Function Execution and Context Accumulation:**
   - Each task in the taskchain receives all previous tasks as implicit arguments, allowing it to access the accumulated context and results from earlier tasks.
   - After executing, the task produces a new task that is added to the chain, representing the next step in the sequence.

2. **Similarity to Reduce Function:**
   - Like "reduce," the taskchain uses an accumulator concept, where each task processes the accumulated context (previous tasks) and produces a new state (the next task).
   - The process is sequential, with each step depending on the results of the previous steps, maintaining coherence and context.

This design allows the AI chat-app to handle complex interactions by chaining together simpler functions, each building on the previous tasks, much like how "reduce" processes elements to build up a result.

## Curated Tasks with Pattern Matching

A typical scenario is when you have a goal that requires several processing steps (e.g., RAG or process automation). Instead of writing a separate tool for each step, you create a single tool that handles the entire process. In Taskyon, this means building a chain of tasks where:

- **Curated Task Chain:** The tool outputs a list of tasks (like a flatmap in functional programming) that is then flattened into a continuous sequence.
- **Subtask Generation:** Each task can generate its own subtasks, keeping the chain flexible.
- **State Machine Behavior:** By using pattern matching on the previous task, the tool determines the next step, effectively acting as a state machine.

This approach lets you define the steps explicitly while leaving enough flexibility for Taskyon to determine transitions dynamically based on specific input/output needs.

Below is a mermaid chart illustrating this principle:

```mermaid
flowchart TB
  A["Goal: Multi-Step Process<br>(e.g., RAG, Automation)"] --> Subchain

  subgraph Task Chain
    direction TB
    subgraph Subchain
      direction LR
      C{{"Task 1: Initial Step"}}
      C2{{"ChatCompletion<br>(pattern/schema)"}}
      C -- generates --> C2
    end
    Subchain --> Subchain2
    subgraph Subchain2
      direction LR
        D{{"Task 2: Intermediate Step"}}
        D2{{"ChatCompletion<br>(pattern/schema)"}}
        D -- generates --> D1 --> D2
    end
    Subchain2 --> E
    E{{"Task 3: Final Step"}}
    G[Next Stage / Final Output]
  end

  E --> G

  B["Curated Tool<br>(Generate Task Chain & follow steps through pattern matching)"]
  B -- inject --> Subchain
  B -- inject --> Subchain2
  B -- inject --> E

```

In many cases, the steps are tightly coupled and require specific input and output data. With this single tool approach---leveraging flatmapping and state machine-like pattern matching---you avoid having to write separate tools for each step while maintaining clear, adaptable transitions.

## Creating Context

Taskyon manages hierarchical tasks using a two-layer structure, which allows both sequential and nested execution. In this design, a primary function task (TW1) initiates a subtask chain (t1). Within that chain, specific tasks like **t1** and **t2** can each spawn their own branches---denoted here as the "a" chain (from t1) and the "b" chain (from t2)---each eventually returning a result.

For example, if you select **b1** in your chat or chatCompletion, the visible sequence might be:

- **TW1 → t1 → t2 → b1**

However, when deeper nesting is enabled, you might see a more extended chain such as:

- **TW1 → t1 → a1 → a2 → a3 → r1 → t2 → b1**

The diagram below illustrates this hierarchical structure with clear branching:

```
            TW1
             │
             ▼
         ┌────────┐
         │   t1   │──► t2 ─► t3 ─► t4 ─► r3
         └────────┘      │
             │         b1
             ▼          │
            a1         r2
             │
             ▼
            a2
             │
             ▼
            a3
             │
             ▼
            r1
```

**Diagram Explanation:**

- **TW1** starts the process.
- **t1** initiates the primary subtask chain, leading to subsequent tasks **t2**, **t3**, **t4**, and finally result **r3**.
- The "a" branch—comprising **a1 → a2 → a3 → r1**—is spawned by **t1**.
- The "b" branch—consisting of **b1** (which then leads to **r2**)—originates from **t2**.

The chatCompletion tool flattens this hierarchical structure to capture the most crucial context for generating responses. This approach ensures that even with nested task chains, the system extracts and prioritizes the relevant information needed for coherent output.

TODO: add a json-example for a tool that can do this..

## Taskyon vs. Classical Programming

To make the distinction crystal clear, think of Taskyon as a dynamic programming language tailored for AI‑driven workflows:

1. **Sequential execution, familiar style**
   - Like a traditional program, Taskyon processes one “line” (task) at a time (or a sequence of parallel chains), each waiting on its predecessor.
   - You still get that clear, step‑by‑step flow—no magic black box.

2. **Static vs. dynamic code**
   - In classic languages your code is fixed at write‑time.
   - In Taskyon, _each new task_ decides on the next function (tool) to call and with which parameters—_at runtime_.
   - Your “program” (the task tree) literally grows and reshapes itself as it runs, adapting to evolving data and state.

3. **Why this matters**
   - **Flexibility:** You can inject specialized tools mid‑execution (e.g. a fast custom parser) without rewriting your entire chain.
   - **Resilience:** Dynamic branching lets you handle errors or alternative flows in‑flight, rather than littering your code with if/else.
   - **Maintainability:** By expressing tasks and tools as data, you can inspect, modify, or even generate your own tools programmatically.

Once you’ve wrapped your head around “tasks as functions” and “the task tree as your program,” building and debugging Taskyon workflows becomes almost as intuitive as writing straight JavaScript—plus you get all the power of runtime adaptability.
