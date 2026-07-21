# Taskyon Configuration Documentation

Taskyon can be configured to meet the needs of various applications. In this documentation, we will cover the different aspects of Taskyon configuration, including the GUI, iframe integration, and configuration options.

### GUI Configuration

Taskyon provides a graphical user interface (GUI) for configuring its settings. The GUI can be accessed by clicking on the gear icon in the top right corner of the Taskyon window.

The GUI is divided into several sections, each corresponding to a different aspect of Taskyon's configuration. These sections include:

- [**LLM Settings**](https://taskyon.space/settings/agent%20config): This section allows you to configure the Large Language Model (LLM) settings, such as the selected API, task template, and function descriptions.
- [**App Configuration**](https://taskyon.space/settings/app%20config): This section allows you to configure the app settings, such as the app configuration URL, gDrive configuration file, and expert mode.

Within the LLM provider settings, Taskyon can also connect directly to ChatGPT Codex through an OAuth login flow. After logging in, the `chatgpt-codex` provider becomes selectable like the other configured providers.

### Iframe Integration

Taskyon can be integrated into a webpage as an iframe. This allows you to embed Taskyon into your own application and customize its behavior.

To integrate Taskyon into your webpage, you will need to create an iframe element and set its src attribute to the URL of the Taskyon app. You can then use JavaScript to communicate with the Taskyon iframe and customize its behavior.

### Example Configuration

Check Taskyon's default configuration on this server: [/taskyon_settings.json](/taskyon_settings.json)

### Toolchain Profiles

Tool settings are stored under `toolchainProfiles`. The `base` profile contains the common
settings and is the configuration currently edited by the settings screens. Named profiles under
`toolchainProfiles.profiles` can override any part of `base`.

When `selectedToolchainProfile` names a profile, Taskyon recursively applies that profile over
`base` for execution. Arrays are replaced, and an explicit `null` remains an overriding value. If
no profile is selected, execution uses an independent copy of `base`. An unknown profile name is a
configuration error and does not fall back to another model or provider.

### Entry-Node-Centric Prompting

Taskyon treats `toolchainProfiles.base.entryNode` as the primary editable orchestration config
surface.

- Prompt templates (`prompt_templates`) live under `entryNode` settings.
- Tool-calling behavior (`providerToolCalling`) is configured at `entryNode`.
- Tool-shortlist behavior is configured at `entryNode` through `use_tool_chooser` and
  `tool_chooser_min_tools`.
- Optional web search execution flags are configured at `entryNode.websearch`, and search only runs when `websearch.enabled` is explicitly set to `true`.

`chatCompletion` remains the execution gateway, while entry-node controls workflow/prompt orchestration.

### Research Access Mode

Structured research defaults live under `toolchainProfiles.base.webResearchPlanner`.

- `researchMode: "websearch-first"` starts with chatCompletion web search and fallback readers.
- `researchMode: "browser-mcp-first"` checks and imports Browser MCP tools before research branches fan out.
- `researchMode: "websearch-only"` avoids Browser MCP tools and keeps research on web search plus support tools.

The default profile uses `websearch-first` so browser and CLI research can start without a local Browser MCP sidecar.

### Conclusion

Taskyon provides a powerful and flexible configuration system that can be used to customize its behavior. By using the GUI, iframe integration, and configuration options, you can tailor Taskyon to meet the needs of your application.
