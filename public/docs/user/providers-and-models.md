# Providers and Models

Taskyon can use Taskyon-hosted models, OpenAI, OpenRouter, ChatGPT Codex through OAuth, and
OpenAI-compatible endpoints.

Open **Settings > AI Service Provider** to choose a provider, authenticate, refresh its model list,
and select a model. Provider-specific keys are stored through Taskyon's secret store rather than in
the profile JSON.

Providers are named toolchain profiles. Each profile remembers its own endpoint and selected model,
so switching back to a provider restores the model last chosen for that profile. Expert users can
add an OpenAI-compatible provider by adding a named profile with a complete `chatCompletion`
configuration under **Edit provider profiles**.

Taskyon is provider-flexible, not capability-identical. The `chatCompletion` gateway normalizes
provider access, while tool calling, structured output, web search, vision, token accounting, and
reasoning options remain model-specific.

## Credentials

Each provider has its own credential entry. Taskyon-hosted access may come from an authenticated
session, a restricted key supplied by an embedding host, a stored Taskyon key, or the shipped
limited free key. Third-party API keys and OAuth tokens are stored under their provider/tool secret
namespace.

Do not put unrestricted provider keys into public HTML or profile JSON. An embedding application
that needs shared access should use a restricted host credential or its own backend policy rather
than exposing a general API key.

## Local endpoints

Choose the local/OpenAI-compatible provider and configure the endpoint that exposes `/v1/models`
and a compatible chat-completion route. Common server choices include Ollama, LocalAI, LM Studio,
vLLM, and other OpenAI-compatible gateways, but versions and compatibility change independently of
Taskyon.

Tool calling, multimodal inputs, structured output, and hosted web search are model capabilities,
not guarantees of the OpenAI-compatible protocol. If a workflow fails only when tools are enabled,
verify that the selected model and endpoint support tool calls.

Local inference can reduce data exposure and per-token billing, but it still consumes local
hardware and does not automatically make remote tools local. Browser requests can also require the
endpoint to allow the Taskyon origin through CORS.

## Cost and context

Hosted cost usually depends on input tokens, output tokens, model choice, provider pricing, and the
number of model/tool turns. Taskyon selects context from the task tree rather than necessarily
sending the entire stored history. Keep instructions and evidence focused, and start a branch or
summary when unrelated history grows.

Taskyon keeps one prompt-cache key for a task-tree root and keeps stable instructions at the front
of router and executor requests. Parallel branches share that key; actual reuse still depends on
the provider, model, minimum cacheable prefix, and exact request prefix. Router and executor tool
schemas differ, so their reuse must be measured as separate request families; a shared key does not
make their request bodies identical. A cache miss is not by itself evidence of a Taskyon error.

When a provider reports usage, Taskyon distinguishes ordinary input, cache reads, cache writes,
and output tokens in request traces. Missing telemetry means unavailable, not zero. Cached-token
pricing and retention are provider-specific, so consult the provider's current terms rather than
assuming a fixed discount.

Pricing pages and model catalogs change frequently. Use the active provider's current model list
and pricing rather than a copied table in Taskyon documentation.

## Advanced settings

**Settings > Agent Configuration** exposes entry-node and tool settings. Prompt templates,
provider tool calling, shortlist mechanics, and optional web search belong to the configured entry
node. Selection guidance for an individual tool belongs to that tool's descriptions and parameter
schema. The `chatCompletion` tool remains the model execution gateway.
