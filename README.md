# Taskyon

<img align="left" src="/public/taskyon_fancy_logo.png" onerror="this.onerror=null; this.src='/taskyon_fancy_logo.png';" alt="Taskyon Fancy Logo" width="200" style="padding-right: 50px;"/>

- 🌐🔗 Seamless Web Integration
- 👥🛠️ Personalized AI Assistant 🤖
- 🏡🌟 Local First
- 🌳✅ Task Trees
- 🛡️🏖️ Tool Sandbox

A Chat & Agent Interface for Users, Experts & Developers based on Tasks! 🚀

You can access a deployed version of Taskyon here: [https://taskyon.space](https://taskyon.space).

---

## Overview

Taskyon is more than just a chat interface; it's a powerful system for managing tasks asynchronously in a tree-like structure. 🌳 This design allows for parallel processing and efficient handling of both conversations and tasks. By leveraging various LLM providers, Taskyon can execute a wide range of tasks, from basic user messages to complex function calls.

Built on the principles of [_local-first_](https://dl.acm.org/doi/10.1145/3359591.3359737) 🏠, Taskyon ensures that most data processing happens on the user's local device, prioritizing data security and user autonomy. Whether used for personalized AI interactions, robust task management, or seamless webpage integration, Taskyon offers flexibility and control while maintaining a familiar chat interface.

Explore Taskyon's documentation for more information: [https://taskyon.space/docs/index](https://taskyon.space/docs/index)

## Philosophy: Personalized AI Interaction & Local First

🤖 **Individualized AI Bots**: Taskyon is built on the principle that every user should have a personalized AI bot. This ensures that the AI adapts organically to each user's specific interactions and needs, evolving through direct, human-centric communication.

👥🛠️ **User-Driven Evolution**: Taskyon blurs the lines between user and developer. Users, through their interactions, play a pivotal role in shaping their AI's learning and capabilities, turning their expertise and feedback into the driving force behind the bot's development. Users themselves often have more task-specific insights than developers and it is important to leverage this.

**Local First Principle**: Taskyon embraces the Local First approach, prioritizing user autonomy and data security. This principle ensures that most of the data processing and AI interactions occur on the user's local device, rather than relying on cloud-based services. Key benefits include:

- 🔐 _Enhanced Safety:_ By processing data locally, Taskyon minimizes the risks associated with data breaches, ensuring that sensitive information remains within the user's control.
- 👑 _Data Sovereignty:_ Users have complete ownership and control over their data, with no dependency on external cloud services.
- 💰 _Cost Efficiency:_ Local processing reduces reliance on cloud services, potentially lowering operational costs.
- 🧪 _Customizable AI Experience:_ Users can tailor their AI's learning and performance to their specific needs, with changes and adaptations being stored and managed locally.

## Features

- **Local First Architecture**: Ensures enhanced data privacy and security while maintaining high performance and user control.
- **Seamless Web Integration**: Enhance your app or webpage with agent capabilities using just a code snippet. No backend required!
- **Service Integration**: Utilizes various LLM providers for executing tasks within conversation threads.
- **OpenAI API Compatibility**: Interface with any OpenAI API compatible endpoint, including locally deployed instances.
- **Task-Based Conversations**: Each message within a conversation is treated as a task, forming a branch in the task tree.
- **Function Tasks**: Execute and manage function tasks with adjustable parameters directly within the interface.
- **Frontend Capabilities**: Execute Python and JavaScript code within a secure sandbox, access a local browser-based vector store, and generate tools on-the-fly.
- **Contextual Task Management**: Attach contexts such as files or other tasks for detailed execution.
- **Format Translation**: Translates the internal task tree into compatible formats for various services.
- **Task Interfaces**: Each task can have a dedicated interface for parameter adjustments and direct execution.
- **Enhanced Markdown Support**: Utilize the full power of markdown, including mermaid graphics, SVG drawings, embedded HTML widgets, and MathJax.
- **Vision Models**: Interface with vision models to extend Taskyon's capabilities beyond text.

## Installation

Taskyon can be accessed directly at [https://taskyon.space](https://taskyon.space). For a local setup:

1. Clone the repository. 📥
2. Run `yarn install` to install dependencies. 🧶
3. Use `quasar build` for a production build or `quasar dev` for a development server. 🏗️

You can also deploy Taskyon using a Docker container. An upcoming desktop app will be available soon.

## Usage

Interact with the application through the chat interface. The frontend allows for direct code execution and tool usage within the sandbox environment. User data and configurations are stored locally for persistent sessions 💬🖥️.

## Cost and Usage Management

Taskyon's approach to managing costs is deeply intertwined with its Local First philosophy. By leveraging local computing resources, Taskyon minimizes the need for external cloud services, leading to significant cost savings. Key aspects include:

- _Local Data Storage:_ Reduces costs associated with cloud storage and data transfer.
- _Local Inference:_ Partial or complete local processing of tasks & tool execution cuts down on cloud computing expenses.
- _Resource Optimization:_ Efficient use of local hardware optimizes performance without incurring additional costs.

Additionally, Taskyon provides real-time monitoring of token usage and exact service costs, ensuring transparency and control over resource consumption. 📊

## Security

Taskyon's commitment to security is evident in its Local First approach, which inherently enhances data protection. By keeping data and processing within the user's local environment, Taskyon significantly reduces the risk of external breaches and unauthorized access. Key features include:

- _Sandboxed Environments:_ Each operation in Taskyon is conducted within a secure, isolated environment, safeguarding against potential vulnerabilities.
- _Desktop Application:_ Offers an additional layer of security and control by running locally, ideal for users seeking an elevated level of data protection.
- _Local Data Storage:_ Ensures that sensitive data is not exposed beyond the local browser environment, maintaining a secure boundary.

## Support

- Join our Taskyon channel: [Matrix Channel](https://matrix.to/#/!UNCbKcBpdEjFduzzMv:matrix.org?via=matrix.org)
- [Documentation](https://taskyon.space/docs/index)

## Roadmap

- _P2P Task Synchronization:_ Facilitate team collaboration with peer-to-peer task synchronization.
- _Autonomous Agents:_ Incorporate agents that independently work on task trees, enhancing automation and efficiency.
- _Desktop App and Container:_ Develop a desktop application and container for easy deployment and enhanced security.

## Contributing

📬 Contributions are welcome. Please adhere to the project's code of conduct and submit pull requests for review.

Here is an introduction on how to get started with Taskyon development:

- [Development](https://taskyon.space/docs/DEVELOPMENT)

## License

📃 Taskyon is released under the MIT License. See LICENSE.md for more details.
