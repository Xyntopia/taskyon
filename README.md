# Taskyon:

<img align="left" src="src/assets/taskyon.svg" width="140">

- 👥🛠️ Personalized AI Assistant 🤖
- 🏡🌟 Local First
- 🌳✅ Task Trees
- 🛡️🏖️ Tool Sandbox

A Chat & Agent Interface for Users, Experts & Developers based on Tasks! 🚀

You can access the deployed app here: [https://taskyon.space](https://taskyon.space).

---

## Overview

Taskyon is a comprehensive chat interface that orchestrates asynchronous task management in a tree-like structure, enabling parallel processing and efficient handling of tasks and conversations. 🌳 It leverages services such as OpenAI, OpenAI Assistants, and Openrouter.ai to execute tasks that range from user messages to complex function calls. Taskyon is built on the principles of [_local-first_](https://dl.acm.org/doi/10.1145/3359591.3359737) 🏠.

## Philosophy: Personalized AI Interaction & Local First

🤖 Individualized AI Bots: Taskyon is built on the principle that every user should have a personalized AI bot. This approach ensures that the AI adapts organically to each user's specific interactions and needs, evolving through direct, human-centric communication rather than pre-defined programming or static instructions like GPTs.

👥🛠️ User-Driven Evolution: Taskyon blurs the lines between user and developer. Users, through their interactions, play a pivotal role in shaping their AI's learning and capabilities, turning their expertise and feedback into the driving force behind the bot's development. Users themselves often have more task-specific insights than developers and it is important to leverage this.

Local First Principle: Taskyon embraces the Local First approach, prioritizing user autonomy and data security. This principle ensures that most of the data processing and AI interactions occur on the user's local device, rather than relying on cloud-based services. Key benefits include:

- 🔐 _Enhanced Safety:_ By processing data locally, Taskyon minimizes the risks associated with data breaches, ensuring that sensitive information remains within the user's control.
- 👑 _Data Sovereignty:_ Users have complete ownership and control over their data, with no dependency on external cloud services.
- 💰 _Cost Efficiency:_ Local processing reduces reliance on cloud services, potentially lowering operational costs.
- 🧪 _Customizable AI Experience:_ Users can tailor their AI's learning and performance to their specific needs, with changes and adaptations being stored and managed locally.

## Features

- **Local First Architecture**: Taskyon's design incorporates the Local First principle, ensuring enhanced data privacy and security while maintaining high performance and user control.
- **Service Integration:** Utilizes OpenAI and Openrouter.ai for executing various tasks within the conversation threads.
- **Task-Based Conversations:** Each message within a conversation is treated as a task with the role "user", forming a branch in the task tree.
- **Function Tasks:** Execute and manage function tasks with adjustable parameters directly within the interface.
- **Frontend Capabilities:** Python code execution within a secure sandbox, access to a local browser-based vector store leveraging HNSWlib, and tool generation on-the-fly with JavaScript or Python.
- **Contextual Task Management:** Attach contexts such as files or other tasks to any given task for detailed execution.
- **Format Translation:** Translates the internal task tree into compatible formats for various services, bypassing the need for specific assistants like OpenAI Assistants.
- **Task Interfaces:** Each task can have a dedicated interface, allowing for parameter adjustments and direct execution.

## Installation

Taskyon can be accessed directly at [https://taskyon.space](https://taskyon.space). For local setup:

1. Clone the repository. 📥
2. Run `yarn install` to install dependencies. 🧶
3. Use `quasar build` for a production build or `quasar dev` for a development server. 🏗️

## Usage

Interact with the application through the chat interface. The frontend allows for direct code execution and tool usage within the sandbox environment. User data and configurations are stored locally for persistent sessions 💬🖥️.

## Cost and Usage Management

Taskyon's approach to managing costs is deeply intertwined with its Local First philosophy. By leveraging local computing resources, Taskyon minimizes the need for external cloud services, leading to significant cost savings. Key aspects include:

- _Local Data Storage:_ Reduces costs associated with cloud storage and data transfer.
- _Local Inference:_ Partial or complete local processing of tasks & tool execution cuts down on cloud computing expenses.
- _Resource Optimization:_ Efficient use of local hardware optimizes performance without incurring additional costs.

Additionally, taskyon provides real-time monitoring of token usage and exact service costs, ensuring transparency and control over resource consumption. 📊

## Security

Taskyon's commitment to security is evident in its Local First approach, which inherently enhances data protection. By keeping data and processing within the user's local environment, Taskyon significantly reduces the risk of external breaches and unauthorized access. Key features include:

- _Sandboxed Environments:_ Each operation in Taskyon is conducted within a secure, isolated environment, safeguarding against potential vulnerabilities.
- _Desktop Application:_ Offers an additional layer of security and control by running locally, ideal for users seeking an elevated level of data protection.
- _Local data storage:_ Ensures that sensitive data is not exposed beyond the local browser environment, maintaining a secure boundary.

## Roadmap

- _P2P Task Synchronization:_ Facilitate team collaboration with peer-to-peer task synchronization.
- _Autonomous Agents:_ Incorporate agents that independently work on task trees, enhancing automation and efficiency.
- _Integrate Local LLM Inference_ Taskyons philsophy is to preserve data privacy as much as possible. Currently there is still the loophole of sending request to services of Generative AI. We are already working on integrating LLMs which run on your local computer which will help here.

## Contributing

📬 Contributions are welcome. Please adhere to the project's code of conduct and submit pull requests for review.

## License

📃 Taskyon is released under the MIT License. See LICENSE.md for more details.
