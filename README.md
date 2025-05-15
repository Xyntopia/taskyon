# Taskyon

<img align="left" src="/public/taskyon_fancy_logo.png" onerror="this.onerror=null; this.src='/taskyon_fancy_logo.png';" alt="Taskyon Fancy Logo" width="200" style="padding-right: 50px;"/>

- 🌳✅ Task Trees
- 🌐🔗 Seamless Web Integration
- 👥🛠️ Hyper-Individualized Workflows
- 🏡🌟 Local First
- 🔧🛡️📈 Tool: Safe & Infinite Scalability
- 🤖 Personalized AI Assistant

A Chat & Agent Interface for Users, Experts & Developers based on Tasks! 🚀

> Tasks are the most fundamental units of problem solving. Taskyon supercharges them.

You can

- use Taskyon here: [https://taskyon.space](https://taskyon.space)
- Or deploy it yourself!

---

## Overview

> _Divide each difficulty into as many parts as is feasible and necessary to resolve it._ – René Descartes

Taskyon takes a step beyond conventional, conversational AI by structuring interactions into a dynamic, evolving tree of tasks rather than a flat chat log. This architecture enables parallel and sequential processing, efficient context management, and powerful function chaining. By breaking down complex requests into dedicated tasks, Taskyon not only simplifies problem solving but also unlocks the ability to scale tool usage by letting the Agent write its own tools.

While apps serve well for uniform experiences, most processes demand hyper-individualization. Taskyon empowers users by focusing on tasks instead of monolithic applications:

- **User-Knowledge First:** True domain experts—your users—define, tailor, and optimize workflows, not developers’ one-size-fits-all defaults.
- **Flexible Task Trees:** Branch, reorder, or extend tasks on the fly to craft bespoke workflows that reflect each user’s unique needs.
- **Continuous Evolution & Hyper-Individualization:** As tasks execute and tools integrate, Taskyon learns, automates, and refines new steps—ensuring workflows become ever more personalized over time.

Built on the principles of [_local-first_](https://dl.acm.org/doi/10.1145/3359591.3359737) 🏠, Taskyon ensures that most data processing happens on the user's local device, prioritizing data security and user autonomy. Whether used for personalized AI interactions, robust task management, or seamless webpage integration, Taskyon offers flexibility and control while maintaining a familiar chat interface.

Explore Taskyon's documentation for more information: [https://taskyon.space/docs/index](https://taskyon.space/docs/index)

## Philosophy: Hyper Individualization & Local First

🤖 **Individualized AI Bots:** Every user deserves a personal AI that learns from direct, human-centric interaction and evolves to become an expert assistant for their specific context.

👥🛠️ **User-Driven Evolution:** Users often have more task-specific insights and drive the AI's development through feedback and real-world expertise. This democratisation of capability ensures tools and workflows mirror actual needs, not developer assumptions.

🚫📱 **Apps Aren't Needed Anymore:** By viewing tasks —not apps— as the core unit:

1. We acknowledge users know best how to organize their workflows.
2. We replace rigid apps with flexible, automated task trees and a UI that adapt over time.
3. We prioritize continuous, user-guided improvement and automation.

**Local First & Infinite Tool Scalability:**

- 🔐 _Enhanced Safety:_ All data and computation remain local unless explicitly shared, minimizing breach surface.
- 👑 _Data Sovereignty:_ Users retain full ownership of their information and workflows and knowhow.
- 💰 _Cost Efficiency:_ Local execution cuts cloud bills; only external calls happen when needed.
- 🚀 _Scalable Tools Ecosystem:_ Add unlimited tools —from LLM providers to custom Python/JavaScript functions— as branches in your task tree, enabling infinite hyper-individualization.

## Features

- **Local First Architecture:** User autonomy, security, and offline capability.
- **Seamless Web Integration:** Enhance your app or webpage with Taskyons agent capabilities with a single snippet — no backend needed.
- **Infinite Tool Scalability:** Create and integrate unlimited tools and services into your workflows, powering hyper-individualized experiences.
- **Service & LLM Integration:** Interface with multiple LLM endpoints, including OpenAI-compatible and self-hosted models.
- **Task-Based Conversations:** Each message is a task node, forming a navigable tree.
- **Function Tasks:** Define, parameterize, and execute tasks as function calls within the interface.
- **Sandboxed Code Execution:** Securely run Python/JavaScript in-browser, with access to vector stores and dynamic tool generation.
- **Contextual Task Management:** Attach files, data sources, and task contexts for rich execution environments.
- **Format Translation:** Export task trees to formats compatible with external services and APIs.
- **Dedicated Task Interfaces:** Fine-tune parameters and manage execution state per task.
- **Enhanced Markdown & Visuals:** Render Mermaid diagrams, SVGs, embedded HTML widgets, and MathJax seamlessly and secure in a sandboxed environment.
- **Vision Models Support:** Integrate and invoke vision-based tasks alongside text workflows.

## Installation

Taskyon can be accessed directly at [https://taskyon.space](https://taskyon.space). For a local setup:

1. Clone the repository. 📥
2. Run `yarn install` to install dependencies. 🧶
3. Use `quasar build` for a production build or `quasar dev` for a development server. 🏗️

Alternatively, deploy via Docker or await our upcoming desktop app.

## Usage

Interact through the chat interface where each interaction spawns tasks. Use the built-in sandbox to execute code, call tools, and chain functions. All data and configurations are stored locally for persistent, secure sessions. 💬🖥️

## Cost and Usage Management

Taskyon minimizes cloud reliance through Local First computing:

- _Local Data Storage:_ Lowers cloud storage and transfer costs.
- _Local Inference & Execution:_ Leverages user hardware for cost-effective computation.
- _Efficient Resource Use:_ Dynamically balance local vs. external processing for optimal performance.

Real-time monitoring of token usage and service costs provides transparency and control. 📊

## Security

Local processing inherently reduces exposure:

- _Sandboxed Environments:_ Isolate each task's code execution in a secure, isolated environment.
- _Optional Containerization:_ Run Taskyon in a secure local container for added protection.
- _No Unnecessary Data Exfiltration:_ User data remains within the browser unless explicitly shared.

## Support

- Join our Taskyon channel: [Matrix Channel](https://matrix.to/#/!UNCbKcBpdEjFduzzMv:matrix.org?via=matrix.org)
- [Documentation](https://taskyon.space/docs/index)

## Roadmap

- _P2P Task Synchronization:_ Collaborate peer-to-peer on shared task trees.
- _Desktop App:_ Nearly ready for cross-platform installation.
- _Taskyon Server:_ Run tasks completly autonomous in the background.

## Contributing

📬 Contributions welcome! Please follow our code of conduct and submit pull requests.

For development guidelines, see [DEVELOPMENT](https://taskyon.space/docs/DEVELOPMENT).

## License

📃 MIT License. See LICENSE.md for details.
