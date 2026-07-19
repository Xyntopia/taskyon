# Prompting and Structured Output

## Make the outcome testable

A useful prompt states:

1. the result to produce;
2. the relevant context and constraints;
3. the expected artifact or response format;
4. how the result should be checked.

Start with the smallest complete request and add detail only when the result exposes ambiguity.
Separate instructions from source material with headings or fenced blocks. State positive
requirements directly instead of relying on a long list of prohibitions.

For example:

```text
Compare SQLite and DuckDB for an offline analytics feature.

Constraints:
- imports are usually below 5 GB;
- one desktop user writes at a time;
- results must be reproducible.

Deliverable:
- a cited Markdown decision memo;
- assumptions that would change the recommendation;
- one small benchmark command we can run locally.
```

## Prompt Taskyon workflows explicitly

For tool-based work, specify the operational evidence you expect:

- Ask for current sources when facts may have changed.
- Name the files or artifacts that should be created.
- Require focused tests or a human verification command.
- State whether external network access or host-file changes are acceptable.
- Ask for alternatives to run as separate branches when they are independent.
- Require blocked downloads, failed checks, and uncertainty to be reported rather than hidden.

Do not assume the model can use a tool because you mentioned it. The runtime must register that
capability, and the active workflow must allow it.

## Structured output

Use structured output when another task or program must consume the result. Prefer a small JSON
Schema with:

- a few required fields;
- enums for closed choices;
- booleans for independent decisions;
- bounded arrays with simple item shapes;
- field descriptions that state units and nullability.

Avoid asking the model to invent a large nested schema in prose. Taskyon's tool parameter schema or
the explicit `chatCompletion` schema should be the contract, and validation failures should produce
an error or retry path. Keep explanatory prose in a separate field or a later message.

Example:

```json
{
  "type": "object",
  "required": ["decision", "confidence", "reasons"],
  "properties": {
    "decision": { "type": "string", "enum": ["accept", "revise", "reject"] },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "reasons": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 5
    }
  }
}
```

## Choose the model intentionally

Test important prompts against the actual provider and model used in production. Models differ in
tool calling, schema compliance, context limits, vision, and instruction following. A newer or
larger model may help, but a narrower schema, better evidence, or a deterministic tool is often the
more reliable fix.

Do not ask a model to reveal hidden system or provider instructions. Those instructions may be
unavailable, protected, or synthesized outside the visible conversation. Configure Taskyon-owned
prompts through the entry-node and tool settings instead.
