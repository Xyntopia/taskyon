# Browser Research

Open **Browser Access** to configure and inspect the paths Taskyon can use to reach the web.

- **ChatCompletion web search** uses search supplied by the selected model provider.
- **Browser MCP** connects to a configured browser MCP endpoint and imports selected tools.
- **Proxy fallback** reads pages through a configured proxy when direct access is unavailable.
- **Research defaults** choose which access path the research planner tries first.

The default `websearch-first` mode starts with hosted search and fallback readers.
`browser-mcp-first` checks Browser MCP before research branches are created.
`websearch-only` avoids Browser MCP.

The page also reports recent activity and displays previews emitted by browser-capable MCP tools.
Provider search and proxy reads do not produce browser screenshots.

Only configure browser endpoints you trust. Imported MCP tools execute with the capabilities of
their server and should be reviewed before use.
