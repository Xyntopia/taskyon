## FAQ

### 1. Local AI Processing Capabilities

**How are the local AI processing capabilities implemented? Are there specific libraries or frameworks used for local inference?**

Taskyon requires an OpenAI API-compatible inference endpoint for communication. The hardware requirements vary based on the AI model's complexity and can range from laptops to systems with enhanced graphics cards. For more details, refer to specific AI documentation available elsewhere.

**What are the hardware requirements or recommendations for running AI models locally?**

Quantized 7B/12B models can run on laptops, though better graphics cards improve performance significantly. Alternatively, cloud-hosted LLMs, such as those from Huggingface, offer diverse options.

### 2. Security and Privacy

**Could you provide more details on the security measures within the sandboxed environments? How is user data isolated and protected?**

User data remains within the browser except during inference, where data protection depends on endpoint privacy settings. If the endpoint is private, full data protection is achieved. Taskyon uses iframes and web workers for isolation and requests explicit permissions for external data sources.

**How does Taskyon handle potential vulnerabilities in the local execution of code and AI models?**

Taskyon promotes local deployment and employs a label-based permission system to control AI data access.

### 3. Service Integration

**What LLM providers are currently supported, and how does Taskyon manage switching between different providers?**

Taskyon supports providers with OpenAI API-compatible endpoints, including LocalAI, Huggingface, Openrouter, and others. Integration can be done via frontend configuration or JSON files. Examples are: [LocalAI](https://github.com/mudler/LocalAI), [Huggingface Text Generation Inference](https://huggingface.co/docs/text-generation-inference/en/index), [Openrouter](https://openrouter.ai/), [Taskyon.space](taskyon.space).

**Are there any plans to support more providers in the future or integrate additional types of services?**

Taskyon is actively developed with a commitment to open-source principles, ensuring adaptability for various applications.

### 4. Function Tasks

**Can you elaborate on the types of function tasks that can be executed? Are there predefined templates or examples?**

Function tasks are frontend-driven, facilitating scalability and security. Tasks range from simple JSON configuration to complex tool generation. Templates can be found here: [https://taskyon.space/tools](https://taskyon.space/tools).

**How flexible is the interface for creating and managing custom function tasks?**

Taskyon's frontend-based execution enhances scalability and security:

- All function execution occurs in the frontend, ensuring scalability and security.
- When run as a desktop app, functions can access the local environment with appropriate permissions.
- Browser-based execution restricts functions to browser capabilities, enforcing sandboxed security.
- Integrating Taskyon into an app confines function declarations to app-defined capabilities, enhancing control and security.

### 5. Contextual Task Management

**How is the context attached to tasks managed and utilized? Are there specific formats or standards for attaching context like files or other tasks?**

Taskyon manages task context through a decentralized task tree:

- Task context and uploaded files are stored in a decentralized task tree within the browser or optionally on a DB backend. Or shared via p2p.
- Each task in the task tree is structured with parent and follow-up tasks, ensuring organized management.
- Tasks follow standardized formats for consistency and accessibility.

**How does Taskyon ensure the relevance and accuracy of context in task execution?**

Taskyon enhances task relevance and accuracy through:

- Vectorization of tasks stored in a local vector store, optimizing task selection based on context.
- Labeling of tasks for precise context control and selection, facilitating accurate task execution.

### 6. Frontend Capabilities

**How are the secure sandbox environments for Python and JavaScript code execution managed? Are there limitations to the code that can be run within these sandboxes?**

Taskyon's frontend manages secure sandbox environments:

- Functions execute within browser sandboxes, limiting access to the current domain and enhancing security.
- Users can choose sandbox types such as web workers or iframes for additional isolation, ensuring robust security measures.
- Code execution adheres to browser restrictions, bolstering sandboxed security.

**Can you provide examples of the types of tools that can be generated on-the-fly using JavaScript or Python?**

Taskyon supports dynamic tool generation primarily in JavaScript:

- Current tools include integrations with APIs, data analysis tools, and interactive elements like Google Maps.
- Python-based tools are under development, leveraging platforms like Pyodide for broader functionality.
- We are working on more documentation right now, stay tuned. Some examples are:
  - Interacting with Google Maps and other apps.
  - Interfacing with Email accounts.
  - doing data analysis using python.
  - Act as a financial advisor by interacting with a wealth Management webpage.

### 7. Webpage Integration

**How can webpage owners integrate Taskyon into their sites? Are there specific scripts or APIs provided for this integration?**

- By including taskyon as an iframe. Taskyon does NOT require you to run any backend for AI! It can be _completly_ configured from the html code of your app (E.g. pure js, ts, vue/react/svelte/angular there are no restrictions on frameworks ).
- example code is given here: [https://taskyon.space/tools](https://taskyon.space/tools).
- A webpage configures taskyon through the iframe. E.g. configure rate limits, and restrictions on which LLM to use.
- A webpage declares functions/tools to taskyon which taskyon can then call when users interact with it. Through this
  mechamism taskyon can essentially interact with any part of the webpage.
- Security is maintained through the browsers sandboxing mechanisms. Taskyon wil be run in its own context for every webpage which calls it in an iframe. This prevents X-site attacks.
- taskyon only has access to the functions it was explicitly given access to.

**Are there any security concerns or best practices for integrating Taskyon into external webpages?**

Taskyon integration adheres to standard iframe security practices:

- Check [https://taskyon.space/tools](https://taskyon.space/tools)
- Embedded Taskyon instances operate within isolated iframes, preventing cross-site scripting and maintaining data security.
- Taskyon interacts solely with functions explicitly granted access by the hosting webpage.

### 8. Enhanced Markdown Support

**What are some use cases for the enhanced markdown features like mermaid graphics, SVG drawings, and embedded HTML widgets?**

Enhanced Markdown in Taskyon supports diverse applications:

- Use cases include generating flowcharts, Gantt diagrams, and interactive presentations.
- Markdown features facilitate complex data visualization, mathematical calculations, and interactive content.
- provide answers and explanations with sophisticated math (e.g. use python sympy for calculation and then present the result) in a visual appealing way with correct math notation.
- Project management tasks

**Are there any limitations or performance considerations when using these enhanced markdown features?**

Performance varies based on LLM capabilities and feature complexity:

- Taskyon's Markdown capabilities rely on LLM performance for tasks like generating mermaid graphics and interactive widgets.
- Ongoing improvements enhance feature robustness and performance.

### 9. Vision Models

**Can you provide more information on the vision models integrated with Taskyon? What tasks or functionalities do they support?**

Taskyon integrates vision models for image interpretation:

- Models support multi-modal functionalities, interpreting images with varying levels of complexity.
- Use cases include image analysis, object recognition, and visual data processing.

### 10. Roadmap

**Can you provide more details on the upcoming features like P2P task synchronization and autonomous agents?**

Upcoming Taskyon features include:

- P2P task synchronization enabling collaborative project contexts and efficient information exchange.
- Autonomous agents for automated task management, enhancing productivity and workflow efficiency.

**What is the timeline for the integration of local LLM inference and the release of the desktop app and container?**

- Taskyon already supports local LLM inference via OpenAI API-compatible endpoints.
- Container deployment precedes the desktop app release, with plans for a static web server version for easy deployment.

### 11. Contribution Guidelines

**What are the specific areas where you need the most help from contributors?**

Taskyon welcomes contributions in several areas:

- Reporting bugs and issues for continuous improvement.
- Developing a library of standard tools to enhance Taskyon's functionality.
- Improving UI/UX to provide a seamless user experience.

**Are there any coding standards or guidelines that contributors should follow?**

Taskyon maintains standardized coding styles and eslint configurations within the project:

- Contributors are encouraged to adhere to these guidelines for consistent code quality and compatibility.
