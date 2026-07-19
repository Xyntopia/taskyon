# MCP and VS Code

## MCP bridge

`@taskyon/taskyon-mcp` adapts Taskyon's tool list and tool-call protocol to MCP JSON-RPC. The bridge
supports `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.

```ts
const bridge = createTaskyonMcpBridge(client)
const response = await bridge.handleRequest(request)
```

Only tools visible through the connected Taskyon client are exposed. Hidden tools remain excluded
unless the bridge is explicitly configured otherwise.

## VS Code extension

Build and run the development extension:

```bash
yarn --cwd packages/taskyon-vscode build
code --extensionDevelopmentPath="$(pwd)/packages/taskyon-vscode" .
```

The extension contributes a Taskyon activity-bar view and commands to open Taskyon in a webview or
external browser. Configure `taskyon.url` and `taskyon.openIn` in VS Code settings.
