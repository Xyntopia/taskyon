# Configuration Ownership

The persisted `TyProfile` has these top-level concerns:

- `version` invalidates profiles whose schema is no longer compatible.
- `appConfiguration` controls host presentation and application behavior.
- `llmSettings` stores host-wide runtime settings such as the entry function and worker concurrency.
- `toolchainProfiles` stores a common `base` configuration and optional named overrides whose
  schemas are owned by runtime tool definitions. Provider endpoint and model settings live under
  each provider profile's `chatCompletion` entry.
- `selectedToolchainProfile` selects an optional named override for execution and therefore selects
  the active provider profile.

An optional `signatureOrKey` supports host-provisioned Taskyon access. Provider credentials and
OAuth tokens do not belong in the profile; they are stored through the secret boundary.

## Sources of truth

The shipped defaults live in `src/assets/taskyon_settings.json`. Durable profile types and defaults
are defined by `src/modules/taskyon/types.ts` and the Taskyon profile schemas. When the persisted
shape changes, bump the profile version in both places rather than adding one-off cleanup code.

Tool parameter schemas are the source of truth for tool settings. Settings UIs should read the
runtime tool definition instead of importing a second tool-specific settings schema. The current
runtime tool schemas are visible in the
[peer API documentation](/resources/peers/local/api); shipped application defaults remain owned by
`src/assets/taskyon_settings.json`.

Named profiles recursively override `base`. Arrays are replaced, and an explicit `null` remains an
override. With no selected profile, execution uses an independent copy of `base`; selecting an
unknown profile is a configuration error.

Profile selection and composition belong to the browser, CLI, or embedding host. Taskyon core
receives only the resolved flat configuration. Browser and CLI hosts apply that value through
`runtime.configure({ toolchainConfig })` on core's capability-scoped runtime port; the command is
not part of the public peer protocol. It updates tool defaults and recreates tools whose immutable
construction settings depend on the configuration.

The AI Configuration page selects the runtime profile independently from the profile editors.
Opening a named profile does not activate it. Quick Settings displays effective values and writes
each changed tool setting back to its current owner. A selected named profile owns a setting only
when that exact path exists in the profile; otherwise the setting is written to `base`.

## Provider profiles

Each provider profile owns its `chatCompletion` provider configuration: the stable
`provider` secret ID, display `name`, selected `model`, `baseURL`, streaming support, routes,
optional static non-secret headers, and optional OAuth metadata. Service-specific attribution
headers such as `HTTP-Referer` and `X-Title` belong in the profiles for providers that use them.
Switching profiles restores that profile's selected model. There is no separate `defaultModel`
fallback.

Endpoint settings are resolved from the active profile by the chat-completion tool. They are not
taken from task-call arguments, so a task cannot redirect a provider credential to another server.
The browser derives provider selection, model discovery, OAuth, and API-key lookup from the same
profiles.

## Entry-node settings

`toolchainProfiles.base.entryNode` is the primary editable owner of workflow routing:

- prompt templates and stable prompt context;
- default and allowed tools;
- provider-native tool calling;
- structured tool-shortlist thresholds;
- multimodal and reasoning options;
- optional hosted web-search settings.

`chatCompletion` executes model calls. It should not become a second owner for entry-node policy.
Use `prependSystemPrompts` for stable instructions and `appendSystemPrompts` for volatile context
that should not invalidate a reusable prompt prefix.

## Research settings

`toolchainProfiles.base.webResearchPlanner` owns the default structured research behavior:

- `websearch-first` starts with hosted search and configured readers;
- `browser-mcp-first` ensures Browser MCP before research branches fan out;
- `websearch-only` avoids Browser MCP.

The browser application exposes these settings through Browser Access. CLI and embedded hosts may
register a different capability set while retaining the same workflow contract.

## Host configuration

`initializeTaskyon(...)` sends a partial profile configuration over the iframe protocol. The host
may also choose a profile name, persistence policy, binding key, registered tools, and missing-key
policy. The Taskyon UI resolves that profile configuration and forwards the resulting flat
configuration to core through the same runtime protocol used by tycli. Host configuration must
remain explicit; avoid module-level defaults that silently bind a particular application
dependency.
