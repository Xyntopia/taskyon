# Troubleshooting

## The model responds but does not call tools

Confirm that the selected model supports tool calling, the tool is visible to the LLM, and the
entry-node configuration allows it. Inspect `/tools` in `tycli` or the runtime tool catalog and
check that the tool's short description clearly distinguishes when it should be selected. Try the
same request without a restricted provider route.

## A sandboxed tool cannot reach an external service

Approve the requested origin when interactive `tycli` prompts. A denial is remembered for the
current session; restart the session to make a fresh decision. This approval applies to sandboxed
tool fetches, not to privileged host tools such as the shell.

## A trace reports few or no cached tokens

Confirm the provider exposes cache telemetry and that the repeated requests use the same provider,
model, task-tree root, tool declaration shape, and stable leading content. Short prefixes may be
below the provider's cache threshold, and router/executor requests intentionally have different
tool declarations. Missing telemetry is unavailable rather than zero.

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
