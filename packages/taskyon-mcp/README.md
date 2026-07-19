# `@taskyon/taskyon-mcp`

Experimental MCP JSON-RPC adapter for Taskyon tools.

`createTaskyonMcpBridge(client, options)` maps the connected Taskyon tool catalog to MCP
`tools/list` and forwards `tools/call` through Taskyon's tool RPC client. The lower-level
`createMcpProtocolBridge(dependencies)` can adapt another tool source to the same request handler.

Currently supported MCP methods:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

The package is private. It does not provide a transport server; the host owns stdio, HTTP, or other
transport framing around `handleRequest`.
