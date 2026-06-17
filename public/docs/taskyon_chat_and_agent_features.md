# Taskyon Chat and Agent Features

The main README now focuses on Taskyon's design-automation direction: research, design,
reproduce. This document keeps the broader chat, agent, tooling, and integration capabilities in
one place.

Taskyon is still a capable local-first chat and agent interface. The difference is that these
features are increasingly being shaped around a sharper product goal: turning useful AI-assisted
work into inspectable and reusable task trees.

## Chat Interface

Taskyon provides a familiar chat surface while storing work as structured tasks instead of a flat
conversation log.

- **Task-based conversations**: each user message can become a task node.
- **Task trees**: branch, inspect, and continue work from previous nodes.
- **Context-aware follow-up**: continue from selected task history instead of always using the
  entire conversation.
- **File attachments**: add local files, images, and artifacts to the working context.
- **Draft handling**: write, attach, paste, and submit tasks from the same interface.
- **Rich technical output**: render Markdown, MathJax, Mermaid diagrams, SVG, and embedded HTML
  widgets.

## Local-First Operation

Taskyon is designed to keep as much work as possible on the user's device.

- **Local storage** for task state, drafts, workflows, and artifacts.
- **Local secret handling** for API keys and service credentials.
- **Optional external calls** only when a model, API, or tool requires them.
- **User-controlled model providers**, including OpenAI-compatible endpoints and local model
  servers.
- **Offline-friendly structure** for locally stored workflows and artifacts.

## Tool Use

Taskyon can connect tasks to tools instead of relying only on model text output.

- **Function tasks** with typed parameters.
- **Dedicated task interfaces** for inspecting and editing tool inputs.
- **Tool manager** for discovering and configuring available tools.
- **JavaScript and Python-style execution paths** for deterministic helpers and analysis.
- **MCP-friendly tooling** for importing and adapting external tool definitions.
- **Local and server-backed tools**, depending on what the workflow needs.

## Sandboxed Execution

When Taskyon runs generated or user-provided code, safety boundaries matter.

- **Browser-based sandboxing** for local execution.
- **Isolated execution contexts** for generated artifacts and widgets.
- **Controlled access to local data** through explicit task and tool interfaces.
- **Optional containerized deployments** for additional isolation in advanced setups.

## Web and App Integration

Taskyon can be embedded into other products or workflows.

- **Iframe integration** for adding Taskyon to existing websites.
- **Configurable app profiles** for welcome messages, colors, tools, and model settings.
- **Taskyon API paths** for creating and displaying tasks programmatically.
- **Embeddable assistant workflows** where Taskyon provides the agent layer for another app.

## Model and Provider Support

Taskyon is model-provider agnostic where possible.

- **OpenAI-compatible APIs** for hosted and self-hosted providers.
- **Local LLM support** through compatible local servers.
- **Vision model support** for image-aware workflows where configured.
- **Token and cost visibility** as the replay and workflow tooling matures.

## Task Tree Capabilities

The task tree is the foundation for the design-automation direction.

- **Branching work**: explore alternatives without losing the original path.
- **Selective continuation**: continue from a specific task node.
- **Tool and function nodes**: represent executable steps explicitly.
- **Artifacts and evidence**: keep files, outputs, and sources near the task that produced them.
- **Future replay**: classify tasks so successful workflows can become cheaper and more reliable to
  rerun.

## Advanced Workflow Ideas

These capabilities support broader use cases beyond the current homepage examples.

- Web research and source collection.
- Technical report generation.
- Spreadsheet and data transformation workflows.
- Code and script generation with execution feedback.
- Modelica and simulation-assisted engineering workflows.
- Supplier, product, or component comparisons.
- Embedded assistants for specialized webpages or internal tools.

## Relationship to the README

The README should answer: **What is Taskyon becoming, and why does it matter?**

This document answers: **What broad chat and agent capabilities does Taskyon expose or build on?**

Both are important. The product direction narrows the story; the feature set explains the platform
that makes that direction possible.
