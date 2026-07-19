# Troubleshooting

## The model responds but does not call tools

Confirm that the selected model supports tool calling, the tool is visible to the LLM, and the
entry-node configuration allows it. Try the same request without a restricted provider route.

## Browser research cannot open pages

Open **Browser Access** and inspect recent activity. Verify the configured mode, Browser MCP URL,
and proxy fallback. Hosted model search does not provide a live browser preview.

## A local model endpoint fails

Check the base URL, model-list route, API key expected by the server, and tool-call support. Browser
requests can also be blocked by CORS even when the endpoint works from `curl`.

## Stored work is missing

Confirm the active profile and browser origin. Browser storage is origin-scoped. For `tycli`, check
`~/.config/tycli`, `$XDG_DATA_HOME/tycli`, and `~/.local/share/tycli`.

## Development diagnostics

Open `/diagnostics` in the browser, or use the focused CLI diagnostics documented in
[Testing and Diagnostics](../developer/diagnostics.md).
