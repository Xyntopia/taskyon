# Browser Research

Open **Browser Access** to configure and inspect the paths Taskyon can use to reach the web.

- **ChatCompletion web search** uses the selected provider's model-controlled search capability when available, with the provider's configured fallback behavior.
- **Browser MCP** connects to a configured browser MCP endpoint and imports selected tools.
- **Fetch transport** controls how sandboxed tools and browser downloads reach HTTP and HTTPS
  targets. Taskyon asks on first use unless a transport was selected already.
- **Local or configured CORS proxy** uses a CORS Anywhere-compatible URL prefix. `yarn dev` starts
  a loopback-only proxy and exposes it through the Taskyon development origin. A CORS proxy can
  read HTTPS request and response contents.
- **Secure Taskyon WSS tunnel** sends traffic through the configured WebSocket proxy. Browser-side
  Rustls keeps HTTPS encrypted until the destination server.
- **Proxy fallback** is the separate web-reader service used by research workflows when direct
  access is unavailable.
- **Research defaults** choose which access path the research planner tries first.

The default `websearch-first` mode starts with hosted search and fallback readers.
`browser-mcp-first` checks Browser MCP before research branches are created.
`websearch-only` avoids Browser MCP.

The page also reports recent activity and displays previews emitted by browser-capable MCP tools.
Provider search and proxy reads do not produce browser screenshots.

Only configure browser endpoints you trust. Imported MCP tools execute with the capabilities of
their server and should be reviewed before use. Custom CORS proxies must implement the CORS
Anywhere prefix convention: append the complete target URL to the configured prefix.
