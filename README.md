# ↗️ Taskyon ↗️:

A Chat & Agent Interface for Users, Experts & Developers  based on Tasks!

## Overview

Taskyon is a comprehensive chat interface that orchestrates asynchronous task management in a tree-like structure, enabling parallel processing and efficient handling of tasks and conversations. It leverages services such as OpenAI, OpenAI Assistants, and Openrouter.ai to execute tasks that range from user messages to complex function calls.

## Features

- **Service Integration:** Utilizes OpenAI and Openrouter.ai for executing various tasks within the conversation threads.
- **Task-Based Conversations:** Each message within a conversation is treated as a task with the role "user", forming a branch in the task tree.
- **Function Tasks:** Execute and manage function tasks with adjustable parameters directly within the interface.
- **Frontend Capabilities:** Python code execution within a secure sandbox, access to a local browser-based vector store leveraging HNSWlib, and tool generation on-the-fly with JavaScript or Python.
- **Contextual Task Management:** Attach contexts such as files or other tasks to any given task for detailed execution.
- **Format Translation:** Translates the internal task tree into compatible formats for various services, bypassing the need for specific assistants like OpenAI Assistants.
- **Task Interfaces:** Each task can have a dedicated interface, allowing for parameter adjustments and direct execution.

## Installation

Taskyon can be accessed directly at taskyon.xyntopia.com. For local setup:

1. Clone the repository.
2. Run `yarn install` to install dependencies.
3. Use `quasar build` for a production build or `quasar dev` for a development server.

**Note:** API keys are browser-restricted for security. A desktop application is available for enhanced capabilities.

## Usage

Interact with the application through the chat interface, utilizing the sidebar for navigation and managing conversation threads. The frontend allows for direct code execution and tool usage within the sandbox environment. User data and configurations are stored locally for persistent sessions.

## Cost and Usage Management

Taskyon provides real-time monitoring of token usage and exact service costs, ensuring transparency and control over resource consumption.

## Security

API keys are confined to the browser's scope, ensuring a secure environment. For extended control, the desktop application can be utilized.

## Roadmap

- **P2P Task Synchronization:** Facilitate team collaboration with peer-to-peer task synchronization.
- **Autonomous Agents:** Incorporate agents that independently work on task trees, enhancing automation and efficiency.

## Contributing

Contributions are welcome. Please adhere to the project's code of conduct and submit pull requests for review.

## License

Taskyon is released under the MIT License. See LICENSE.md for more details.

