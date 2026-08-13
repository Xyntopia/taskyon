# Capabilities and Limits

Taskyon combines a chat interface with task trees, explicit tools, local storage, and host-provided
capabilities. It is intended for inspectable design, research, coding, analysis, and engineering
workflows rather than unbounded autonomous operation.

## Current capabilities

- Store conversations as branching task trees instead of one flat transcript.
- Call typed tools and record their arguments, results, errors, and follow-up tasks.
- Run browser JavaScript and Pyodide-based Python tools in isolated execution environments.
- Attach files and render technical Markdown, equations, diagrams, code, SVG, and supported widgets.
- Use hosted providers or local OpenAI-compatible model endpoints.
- Perform structured browser research using provider search, Browser MCP, and configured readers.
- Embed Taskyon in another webpage and expose narrowly scoped host tools.
- Run shared workflows from the browser, `tycli`, or supported desktop surfaces.
- Import, inspect, evaluate, and Git-synchronize immutable design-graph projects.
- Work with Modelica compilation and simulation through the experimental engineering tools.

## Runtime boundaries

Capabilities are registered by the active host:

- Browser Taskyon is limited by browser permissions, origin rules, and the tools registered by the
  application.
- An embedded Taskyon iframe cannot inspect its parent page unless the parent explicitly registers
  a client tool.
- `tycli` and desktop tools can access host files or commands when those capabilities are
  registered. Their operating-system access is not equivalent to a browser sandbox.
- Imported MCP tools have the permissions of their MCP server.

Tool availability therefore varies between sessions. A prompt cannot create access that the host
did not provide.

## Local-first does not mean offline-only

Task records, profiles, indexes, files, and secrets use local storage by default. Data still leaves
the device when it is sent to a model provider, remote tool, proxy, browser service, MCP server, or
other configured endpoint. Fully local operation requires both a local model endpoint and local
tools.

## Model-dependent behavior

Tool calling, vision, structured output, long context, hosted search, and reasoning controls depend
on the selected provider and model. OpenAI API compatibility alone does not guarantee these
features. Smaller local models may need simpler prompts, narrower tool sets, and more explicit
verification.

Token cost and latency depend on the provider, model, selected task context, tool calls, and output
size. Taskyon can select a task-tree projection instead of sending every stored task, but users
should still start a new branch or summarize when irrelevant context grows.

## Experimental areas

P2P discovery and chat, workflow replay, generated tools, Modelica support, and some desktop
capabilities are experimental. The repository contains active design notes for future storage,
network, and sandbox boundaries; those notes are direction rather than a promise of implemented
behavior.

Taskyon has not undergone a formal security audit. Isolation and encryption reduce exposure, but
they do not make an untrusted tool, provider, endpoint, or generated program safe.

## Example workflows

Useful requests are concrete and verifiable:

- Research a technical choice, save cited evidence, and write a decision memo.
- Compare products or components against explicit constraints.
- Analyze a CSV, generate a report, and leave a reproducible command.
- Build a local webpage or tool and verify it in the target runtime.
- Create a Modelica experiment and compare its output with a reference.
- Add a narrowly scoped tool for a host application, such as reading a selection or updating a map.

For better requests, see [Prompting and Structured Output](prompting.md).
